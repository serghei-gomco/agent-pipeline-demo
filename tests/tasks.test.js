import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

describe("Tasks Management", () => {
  it("should create a new task and verify it appears in the list", async (context) => {
    const testdriver = TestDriver(context);

    const appUrl = process.env.APP_URL || "http://localhost:5173";
    await testdriver.provision.chrome({ url: appUrl });

    // Focus and fill the new task title input
    const input = await testdriver.find("New task input");
    await input.click();
    await testdriver.type("Buy groceries");

    // Click Add button to create task
    const addButton = await testdriver.find("Add button");
    await addButton.click();

    // Verify the task item appears in the list
    const assertResult = await testdriver.assert("a task with title 'Buy groceries' appears in the list");
    expect(assertResult).toBeTruthy();
  });

  it("should allow filtering between All and Overdue tasks", async (context) => {
    const testdriver = TestDriver(context);

    const appUrl = process.env.APP_URL || "http://localhost:5173";
    await testdriver.provision.chrome({ url: appUrl });

    // Click filter button for Overdue tasks
    const overdueFilter = await testdriver.find("Filter button with text 'Просроченные'");
    await overdueFilter.click();

    // Verify active filter state
    const assertResult = await testdriver.assert("the filter shows overdue tasks or empty state if none are overdue");
    expect(assertResult).toBeTruthy();
  });
});
