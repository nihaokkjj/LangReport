import { assembleVegaLite } from "flint-chart";

const demoSpec = assembleVegaLite({
  data: {
    values: [
      { month: "Jan", sales: 120 },
      { month: "Feb", sales: 180 },
      { month: "Mar", sales: 160 }
    ]
  },
  semantic_types: {
    month: "Month",
    sales: "Quantity"
  },
  chart_spec: {
    chartType: "Line Chart",
    encodings: {
      x: { field: "month" },
      y: { field: "sales" }
    },
    baseSize: { width: 640, height: 360 }
  }
});

console.log("render-worker ready", {
  backend: "vega-lite",
  demoSpecKeys: Object.keys(demoSpec)
});

setInterval(() => {
  console.log("render-worker waiting for Render Jobs");
}, 30_000);
