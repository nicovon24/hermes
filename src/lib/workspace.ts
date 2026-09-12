import "server-only";

import { getBuyerCompanyId } from "@/lib/demo-workspace";
import { prisma } from "@/lib/prisma";

export async function getCurrentWorkspace() {
  const buyerCompanyId = getBuyerCompanyId();

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: buyerCompanyId },
    select: { id: true, legalName: true, kind: true },
  });

  return {
    company: {
      id: company.id,
      legal_name: company.legalName,
      kind: company.kind as "BUYER",
    },
  };
}
