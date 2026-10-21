export const dynamic = "force-dynamic";

// Source PDFs and images are deliberately processed in the browser only.  This
// route remains only to give older clients a clear response instead of silently
// persisting an uploaded document.
export async function POST() {
  return Response.json(
    { error: "La aplicación ya no conserva archivos fuente. Importa el documento para revisarlo y guardar solo los cartones confirmados." },
    { status: 410 },
  );
}
