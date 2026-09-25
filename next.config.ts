import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics off disk at require time, which webpack
  // can't trace into a bundle — keep it external so the PDF routes work on
  // serverless the same way they do locally.
  serverExternalPackages: ["pdfkit"],
  // The brand TTFs are read from disk at render time, so they have to be
  // traced into the serverless bundle or font registration throws in
  // production while working fine locally.
  outputFileTracingIncludes: {
    "/*": ["src/lib/pdf/fonts/**/*"],
  },
};

export default nextConfig;
