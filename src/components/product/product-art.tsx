import Image from "next/image";
import type { CatalogImage, Graphic } from "@/lib/catalog/types";
import { TeeMockup } from "./tee-mockup";

type ProductArtProps = {
  /** The photo to show. When there isn't one yet, a drawn tee stands in. */
  image: CatalogImage | null;
  /** What the picture shows, for screen readers. Empty when it is decoration. */
  label: string;
  /** Garment and print colors for the stand-in drawing. */
  color: { hex: string; ink: string };
  graphic: Graphic;
  view?: "front" | "back";
  /** How wide the picture is on screen, so the browser fetches the right size. */
  sizes: string;
  /** Space around the stand-in drawing. Photos always fill the box. */
  padding?: string;
  priority?: boolean;
  className?: string;
};

/**
 * A product picture that fills its parent, which must be `relative` and have a
 * set shape (for example `aspect-[4/5]`).
 */
export function ProductArt({
  image,
  label,
  color,
  graphic,
  view,
  sizes,
  padding = "p-8",
  priority = false,
  className = "",
}: ProductArtProps) {
  if (image) {
    return (
      <Image
        src={image.url}
        alt={image.alt || label}
        fill
        sizes={sizes}
        priority={priority}
        className={`object-cover ${className}`}
      />
    );
  }

  return (
    <div className={`flex h-full w-full items-center justify-center ${padding}`}>
      <TeeMockup
        color={color.hex}
        ink={color.ink}
        graphic={graphic}
        view={view}
        label={label}
        className={`h-full w-full ${className}`}
      />
    </div>
  );
}
