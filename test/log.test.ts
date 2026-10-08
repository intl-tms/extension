import { describe, expect, it, vi } from "vitest";
import { createLog } from "../src/panel/log.js";
import { DIAGNOSTICS } from "../src/shared/strings.js";

const at = (hours: number, minutes: number, seconds: number) => () => new Date(2026, 0, 5, hours, minutes, seconds);

describe("the diagnostic log", () => {
  it("LG1 an added entry's text is in the log", () => {
    const log = createLog();
    log.add("save", "saved");
    expect(log.text()).toContain("saved");
  });

  it("LG2 an entry added at 09:05:03 local time is stamped 09:05:03", () => {
    const log = createLog({ now: at(9, 5, 3) });
    log.add("save", "saved");
    expect(log.text()).toMatch(/^09:05:03 /);
  });

  it("LG3 the channel is shown", () => {
    const log = createLog({ now: at(9, 5, 3) });
    log.add("save", "saved");
    expect(log.text()).toBe("09:05:03  save  saved");
  });

  it("LG4 two entries appear in arrival order", () => {
    const log = createLog({ now: at(9, 5, 3) });
    log.add("open", "first");
    log.add("save", "second");
    expect(log.text()).toBe("09:05:03  open  first\n09:05:03  save  second");
  });

  it("LG5 each line of a two-line detail is indented beneath its entry", () => {
    const log = createLog({ now: at(9, 5, 3) });
    log.add("save", "PUT k", "{\n}");
    expect(log.text()).toBe("09:05:03  save  PUT k\n    {\n    }");
  });

  it("LG6 exceeding the limit by one drops the oldest entry", () => {
    const log = createLog({ limit: 3 });
    for (const text of ["one", "two", "three", "four"]) log.add("x", text);
    expect(log.entries().map((entry) => entry.text)).not.toContain("one");
  });

  it("LG7 the newest entry is present", () => {
    const log = createLog({ limit: 3 });
    for (const text of ["one", "two", "three", "four"]) log.add("x", text);
    expect(log.entries().at(-1)?.text).toBe("four");
  });

  it("LG8 the log holds exactly the limit", () => {
    const log = createLog({ limit: 3 });
    for (const text of ["one", "two", "three", "four"]) log.add("x", text);
    expect(log.entries()).toHaveLength(3);
  });

  it("holds 200 entries by default", () => {
    const log = createLog();
    for (let i = 0; i < 205; i++) log.add("x", String(i));
    expect(log.entries()).toHaveLength(200);
  });

  it("LG9 a cleared log holds nothing", () => {
    const log = createLog();
    log.add("x", "one");
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it("LG10 an empty log shows the invitation sentence", () => {
    expect(createLog().text()).toBe(DIAGNOSTICS.empty);
  });

  it("LG11 a subscriber is notified of an entry", () => {
    const log = createLog();
    const listener = vi.fn();
    log.subscribe(listener);
    log.add("x", "one");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("LG12 a subscriber is notified of a clear", () => {
    const log = createLog();
    log.add("x", "one");
    const listener = vi.fn();
    log.subscribe(listener);
    log.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribed listener is not notified", () => {
    const log = createLog();
    const listener = vi.fn();
    log.subscribe(listener)();
    log.add("x", "one");
    expect(listener).not.toHaveBeenCalled();
  });
});
