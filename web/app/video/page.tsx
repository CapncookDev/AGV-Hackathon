import { site } from "@/site.config";

export const metadata = { title: "Video" };

export default function VideoPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Demo video</h1>
      {site.videoEmbedUrl ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border border-black/10">
          <iframe
            src={site.videoEmbedUrl}
            className="h-full w-full"
            title="Demo video"
            allow="fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <p className="opacity-70">No video yet. Set <code>videoEmbedUrl</code> in <code>web/site.config.ts</code>.</p>
      )}
    </div>
  );
}
