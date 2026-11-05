import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { parseChanges, plural } from "../../src/changes";
import { dataset, metadata, parcels } from "./fixtures";
import { fixture } from "./investment-fixtures";

vi.mock("../../src/RadarMap", () => ({ default: () => <div aria-label="Mapa testowa" /> }));

const changes = {
  schemaVersion: 1,
  generatedAt: "2026-11-02T03:30:00Z",
  since: "2026-10-03",
  days: [
    { date: "2026-10-30", permits: [], investments: [{ id: "test:1", title: "TEST ONLY park", recordType: "project", sourceId: "bo" }] },
    {
      date: "2026-10-31",
      permits: [
        { id: "test-application", title: "TEST: budowa domu", kind: "application", locality: "Ożarów Mazowiecki" },
        { id: "test-removed", title: "TEST: usunięty", kind: "decision", locality: "Duchnice" },
      ],
      investments: [],
    },
  ],
};

function stub(changeLog: unknown = changes, failChanges = false) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: !(failChanges && url.includes("changes.json")), status: failChanges && url.includes("changes.json") ? 503 : 200,
    json: async () => url.includes("changes.json") ? changeLog
      : url.includes("investments.json") ? fixture()
        : url.includes("permits.json") ? dataset
          : url.includes("parcels.geojson") ? parcels : metadata,
  })));
}
async function load() {
  render(<App />);
  await waitFor(() => expect(screen.getByTestId("data-status")).toHaveAttribute("data-state", "ready"));
  await waitFor(() => expect(screen.getByTestId("investments-status")).toHaveAttribute("data-state", "ready"));
}
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Lista zmian", () => {
  it("lists new records per day, newest first, and opens a record's card", async () => {
    stub();
    await load();
    const opener = screen.getByRole("button", { name: "Lista zmian" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Lista zmian" });
    const days = await within(dialog).findAllByRole("heading", { level: 3 });
    expect(days.map(d => d.textContent)).toEqual(["sobota, 31 października 2026", "piątek, 30 października 2026"]);
    expect(within(dialog).getByText("2 nowe budowy")).toBeInTheDocument();
    expect(within(dialog).getByText("1 nowa inwestycja")).toBeInTheDocument();
    expect(within(dialog).getByText(/Historia od 3 października 2026\./)).toBeInTheDocument();
    // A record no longer in the dataset stays listed, but cannot be opened.
    expect(within(dialog).queryByRole("button", { name: /TEST: usunięty/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/nie ma go już w bieżącym zbiorze/)).toBeInTheDocument();
    // Opening a record hidden by the default 3-month period widens the filters and shows its card.
    fireEvent.click(within(dialog).getByRole("button", { name: /TEST: budowa domu/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "TEST: budowa domu" })).toBeInTheDocument();
  });

  it("opens investments too and closes with Escape back to the opener", async () => {
    stub();
    await load();
    const opener = screen.getByRole("button", { name: "Lista zmian" });
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole("button", { name: /TEST ONLY park/ }));
    expect(screen.getByRole("heading", { level: 2, name: "TEST ONLY park" })).toBeInTheDocument();
  });

  it("explains an empty history and a failed read", async () => {
    stub({ ...changes, days: [] });
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Lista zmian" }));
    expect(await screen.findByText("Brak nowych rekordów")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    stub(changes, true);
    fireEvent.click(screen.getByRole("button", { name: "Lista zmian" }));
    expect(await screen.findByText("Nie udało się wczytać listy zmian.")).toBeInTheDocument();
    stub();
    fireEvent.click(screen.getByRole("button", { name: "Ponów odczyt" }));
    expect(await screen.findByText("2 nowe budowy")).toBeInTheDocument();
  });
});

describe("change log helpers", () => {
  it("validates the format and uses Polish plural forms", () => {
    expect(() => parseChanges({ ...changes, schemaVersion: 2 })).toThrow();
    expect(() => parseChanges({ ...changes, days: [{ date: "2026-10-31", permits: [{ id: "" }], investments: [] }] })).toThrow();
    expect([1, 2, 5, 12, 22, 25].map(n => plural(n, "nowa budowa", "nowe budowy", "nowych budów"))).toEqual(
      ["1 nowa budowa", "2 nowe budowy", "5 nowych budów", "12 nowych budów", "22 nowe budowy", "25 nowych budów"]);
  });
});
