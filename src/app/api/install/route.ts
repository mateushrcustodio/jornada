import { NextResponse } from "next/server";
import { appUrl, isDemo } from "@/lib/bitrix/config";
import { rest, unwrap } from "@/lib/bitrix/client";
import { getSession } from "@/lib/bitrix/session";
import { BitrixError } from "@/lib/bitrix/errors";
import { assertSameOrigin, errorResponse } from "@/lib/http";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (isDemo())
      throw new BitrixError(
        "DEMO_MODE",
        "A instalação está disponível apenas no modo conectado ao Bitrix24.",
        409,
      );
    const session = await getSession();
    const admin = await rest<boolean>(session, "user.admin");
    if (admin.result !== true)
      throw new BitrixError(
        "ADMIN_REQUIRED",
        "Somente um administrador do Bitrix24 pode registrar os placements.",
        403,
      );
    const handler = `${appUrl()}/api/bitrix/placement`;
    const current = unwrap<{ placement: string; handler: string }>(
      (await rest(session, "placement.get")).result,
    );
    for (const placement of ["CRM_ANALYTICS_MENU", "CRM_DEAL_DETAIL_TAB"]) {
      if (
        !current.some((p) => p.placement === placement && p.handler === handler)
      )
        await rest(session, "placement.bind", {
          PLACEMENT: placement,
          HANDLER: handler,
          TITLE: placement === "CRM_ANALYTICS_MENU" ? "Jornada CRM" : "Jornada",
          LANG_ALL: {
            br: {
              TITLE:
                placement === "CRM_ANALYTICS_MENU" ? "Jornada CRM" : "Jornada",
            },
          },
        });
    }
    return NextResponse.json({
      ok: true,
      placements: ["CRM_ANALYTICS_MENU", "CRM_DEAL_DETAIL_TAB"],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
