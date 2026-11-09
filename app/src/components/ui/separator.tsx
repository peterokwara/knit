/* eslint jsdoc/require-jsdoc: off, jsdoc/require-param: off, jsdoc/require-returns: off */
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "cn";

/** Render a horizontal or vertical divider between related content. */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
