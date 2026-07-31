export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { error: "Los PDF se procesan localmente y no se almacenan en la plataforma." },
    { status: 410 },
  );
}
