import { redirectToDocument } from "../document";

// The sheet is drawn with pdfkit, which needs Node (fs, font files).
export const runtime = "nodejs";

// Public 2D-blueprint PDF for a shared project, drawn from the saved
// design. Valid for both the client (share_token) and crew (crew_token) links.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  return redirectToDocument(token);
}
