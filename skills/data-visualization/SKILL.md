---
name: data-visualization
description: Pick the chart that answers the question, build it (matplotlib, plotly, Vega-Lite, or plain HTML/SVG), label it honestly and use accessible colours. Use for "make a chart", "plot this", "visualise the data", "which chart should I use", "improve this graph".
---

# Data Visualization

## When to use

Turning data into a chart for a report, notebook, slide, web page or README. Also for critiquing and fixing an existing chart. For a multi-chart interactive page with filters, use the dashboards skill if available.

## Gather first

- The one question the chart must answer, and the audience. A chart that tries to answer three questions answers none.
- Where it will live: static image (PNG/SVG for docs), interactive (HTML), or embedded in an existing web app (use its charting library and design tokens).
- The data itself, checked: units, time zone, grain, missing periods. Plot from real data, never invented placeholder values presented as real.
- Brand colours or style constraints, if any.

## Choose the form from the question

- **Change over time:** line chart; columns for few, discrete periods.
- **Compare categories:** horizontal bar chart, sorted by value unless the categories have a natural order.
- **Part of a whole:** stacked bar or a simple bar of shares; pie only for two to four slices with clearly different sizes.
- **Distribution:** histogram, box or violin plot, or a strip/dot plot for small samples.
- **Relationship between two measures:** scatter plot, with a trend line only if it is justified.
- **Ranking or before/after per item:** dot plot or slope chart.
- **Two dimensions of categories:** heatmap.
- **A single headline number:** show the number, large, with context (compared to what?), not a chart.

Avoid 3D, dual y-axes (usually two aligned charts are clearer), and decorative chart types that hide the comparison.

## Procedure

1. Prepare a tidy table with exactly the rows and columns to plot. Aggregate in code, and print the table to check it.
2. Pick the tool already in use in the project. Otherwise: matplotlib or seaborn for static Python output, plotly for quick interactive HTML, Vega-Lite for declarative specs, plain SVG/HTML when you want zero dependencies.
3. Build the simplest version that answers the question.
4. Make it honest:
   - Bar charts start at zero. Line charts may zoom, but make the axis range visible.
   - Use consistent intervals on time axes; show gaps instead of interpolating across missing data.
   - Show uncertainty (intervals, bands) when the data is estimated.
   - Label units and the data source and date range.
5. Make it readable:
   - A title that states the takeaway ("Signups doubled after the March launch"), with a subtitle for the precise definition.
   - Direct labels on lines or bars instead of a distant legend where practical.
   - Remove clutter: heavy gridlines, borders, redundant tick labels, excess decimals.
   - Readable font sizes at the final display size.
6. Make it accessible:
   - Use a colour-blind-safe palette (for example Okabe–Ito or viridis-family schemes) and do not rely on red versus green alone.
   - Keep the number of colours small; highlight the one series that matters and grey the rest.
   - Sequential data gets a sequential palette, data diverging around a meaningful midpoint gets a diverging one, and categories get distinct hues.
   - Ensure text contrast, and provide alt text or a one-sentence description for images.
7. Render and look at it. Save the file, open the image or page, and check that labels are not clipped, overlapping or truncated, and that the takeaway is visible in a few seconds.

## Pitfalls

- Too many categories: group the tail into "Other", or use small multiples.
- Cumulative charts that hide a decline in the underlying rate.
- Percentages without the base count.
- Smoothing that removes the very spike being discussed.
- Mismatched axis scales across small multiples when comparison is intended (share axes).
- Log scales without saying so in the axis label.

## Deliver

Lead with the chart file path (or where it was embedded) and its one-line takeaway. Include the script that generates it so it can be re-run when data changes. Mention the choices a reader might question (axis truncation, excluded data, smoothing) and confirm you viewed the rendered output, or say plainly that you could not.
