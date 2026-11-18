import Image from "next/image";
import mark from "@/app/icon.png";

export function BrandMark({ className }: { className?: string }) {
  return (
    <Image
      className={className}
      src={mark}
      alt=""
      width={36}
      height={36}
      unoptimized
    />
  );
}
