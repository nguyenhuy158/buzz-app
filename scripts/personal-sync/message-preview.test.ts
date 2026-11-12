import { expect, it } from "vitest";
import { messagePreview } from "../../plugins/personal-lists/message-preview";

it("shows message text without markdown syntax, URLs, or raw HTML", () => {
  expect(
    messagePreview(
      "**Release ready** · [Build](https://example.org/build)\n\n- Review `notes`\n- ![Diagram](https://example.org/a.png)",
    ),
  ).toBe("Release ready · Build\nReview notes\nDiagram");
  expect(messagePreview("<script>alert(1)</script>\n\nSafe")).toBe("Safe");
});
