import { fromMarkdown } from "mdast-util-from-markdown";
import type { RootContent, Root } from "mdast";

export function messagePreview(source: string) {
  function text(node: Root | RootContent): string {
    if (node.type === "html" || node.type === "definition") return "";
    if ("value" in node) return node.value;
    if (node.type === "image" || node.type === "imageReference")
      return node.alt ?? "";
    if (node.type === "break") return "\n";
    if ("children" in node)
      return node.children
        .map(text)
        .join(
          ["root", "list", "listItem", "blockquote"].includes(node.type)
            ? "\n"
            : "",
        );
    return "";
  }
  return text(fromMarkdown(source)).trim();
}
