import { Home } from "./home";
import { PublicIndex, shouldRenderPublic } from "@/server/public-blog";

export const HostHome = async ({ request }: { request: Request }) => {
  if (await shouldRenderPublic(request)) return <PublicIndex request={request} />;
  return <Home />;
};
