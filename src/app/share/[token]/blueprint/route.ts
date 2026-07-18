import { redirectToDocument } from "../document";

// Public 2D-blueprint PDF for a shared project. Valid for both the
// client (share_token) and crew (crew_token) links.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  return redirectToDocument(token, "blueprint");
}
