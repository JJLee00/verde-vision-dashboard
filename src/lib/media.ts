// Limits on project media, shared by the uploader and anything that renders
// what was uploaded.
//
// COUNT is a product decision: a homeowner will not watch five walkthroughs,
// and three keeps the client page readable.
//
// SIZE is an account one. Storage and egress are shared across every project:
// the Supabase free tier allows 1 GB of files and 5 GB of egress a month, so
// the old 300 MB cap meant three videos on ONE project came to 900 MB, and a
// client watching one of them a dozen times spent the month's bandwidth on a
// single yard. 100 MB is still a generous three or four minutes of 1080p.
export const MAX_VIDEOS = 3;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
