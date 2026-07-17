import { redirectToDocument } from "../document";

// Public estimate PDF for a shared project. Client link only — the
// document helper 404s for crew tokens, which must never see pricing.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  return redirectToDocument(token, "estimate");
}
