/** Pure share-card model and card node tree shared by public and OG Workers. */
export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;
export type OgFontFamily = "Geist" | "Geist Mono" | "Newsreader" | "Space Grotesk" | "Hanken Grotesk";

export type OgCardModel = {
  kind: "post" | "home";
  mode: "light" | "dark";
  colors: { bg: string; fg: string; muted: string; hairline: string; accent: string };
  fonts: { heading: OgFontFamily; body: OgFontFamily };
  headingWeight: number;
  radius: number;
  siteName: string;
  host: string;
  title: string;
  titleSize: number;
  description: string | null;
  descriptionLines: number;
  /** Bottom-left line: date, and the byline/agent credit when relevant. */
  meta: string | null;
};

/** Families a model needs registered (deduplicated). */
export function ogCardFontFamilies(model: OgCardModel): OgFontFamily[] {
  return [...new Set<OgFontFamily>([model.fonts.heading, model.fonts.body])];
}

type CardStyle = Record<string, string | number>;
export type OgCardNode =
  | { type: "container"; style?: CardStyle; children?: OgCardNode[] }
  | { type: "text"; text: string; style?: CardStyle };

const box = (style: CardStyle, children: OgCardNode[] = []): OgCardNode => ({ type: "container", style, children });
const text = (value: string, style: CardStyle): OgCardNode => ({ type: "text", text: value, style });

export function buildOgCardNode(model: OgCardModel): OgCardNode {
  const { colors, fonts } = model;
  const eyebrow = model.kind === "post" ? model.siteName : model.host;

  const header = box({ display: "flex", alignItems: "center", gap: 18 }, [
    box({ width: 22, height: 22, borderRadius: Math.min(model.radius, 11), backgroundColor: colors.accent }),
    text(eyebrow, {
      fontFamily: fonts.body,
      fontSize: 28,
      fontWeight: 600,
      color: colors.fg,
      letterSpacing: "-0.01em",
      lineClamp: 1,
      textOverflow: "ellipsis",
    }),
  ]);

  const titleBlock = box({ display: "flex", flexDirection: "column", gap: 26 }, [
    text(model.title, {
      fontFamily: fonts.heading,
      fontSize: model.titleSize,
      fontWeight: model.headingWeight,
      lineHeight: 1.08,
      letterSpacing: fonts.heading === "Geist Mono" ? "-0.03em" : "-0.025em",
      color: colors.fg,
      textWrap: "balance",
      lineClamp: 3,
      textOverflow: "ellipsis",
    }),
    ...(model.description
      ? [
          text(model.description, {
            fontFamily: fonts.body,
            fontSize: 30,
            fontWeight: 400,
            lineHeight: 1.4,
            color: colors.muted,
            lineClamp: model.descriptionLines,
            textOverflow: "ellipsis",
            maxWidth: 940,
          }),
        ]
      : []),
  ]);

  const footer = box(
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 32,
      borderTopWidth: 2,
      borderTopStyle: "solid",
      borderTopColor: colors.hairline,
      paddingTop: 28,
    },
    [
      text(model.meta ?? "", {
        fontFamily: fonts.body,
        fontSize: 24,
        fontWeight: 500,
        color: colors.muted,
        lineClamp: 1,
        textOverflow: "ellipsis",
        flexShrink: 1,
      }),
      text(model.host, {
        fontFamily: fonts.body,
        fontSize: 24,
        fontWeight: 600,
        color: colors.accent,
        flexShrink: 0,
      }),
    ],
  );

  return box(
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      width: OG_CARD_WIDTH,
      height: OG_CARD_HEIGHT,
      padding: model.kind === "post" ? "68px 80px 60px" : "68px 80px 76px",
      backgroundColor: colors.bg,
    },
    // The home card anchors the blog name low, like a masthead on a cover.
    model.kind === "post" ? [header, titleBlock, footer] : [header, titleBlock],
  );
}
