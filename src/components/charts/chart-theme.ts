/** Chart colors come from the spec tokens. Fixed order: identity follows the series, never rank. */
export const CHART = {
  grid: "#1E3042",
  axis: "#718198",
  tooltipBg: "#101B29",
  tooltipBorder: "#2A4157",
  text: "#F3F6FB",
  series: {
    sent: "#FF7900",
    replies: "#5C9DFF",
    positive: "#26C281",
  },
} as const;
