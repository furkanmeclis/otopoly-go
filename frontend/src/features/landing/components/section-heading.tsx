import { Reveal } from "@/features/landing/components/reveal";
import { cn } from "@/lib/utils";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        align === "center" && "mx-auto text-center",
        "max-w-2xl",
        className,
      )}
    >
      <p className="text-primary text-sm font-semibold tracking-wide uppercase">
        {eyebrow}
      </p>
      <h2 className="font-display mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg">
          {description}
        </p>
      ) : null}
    </Reveal>
  );
}
