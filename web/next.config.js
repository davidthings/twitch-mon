const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
module.exports = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  assetPrefix: basePath ? `${basePath}/` : undefined,
  basePath: basePath || undefined,
};
