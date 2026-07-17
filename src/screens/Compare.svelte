<script lang="ts">
  import { Chart, Svg, Axis, Bars } from 'layerchart';
  import { scaleBand, scaleLinear } from 'd3-scale';

  const data = [
    { hour: '00', kwh: 0.4 },
    { hour: '06', kwh: 0.9 },
    { hour: '12', kwh: 1.3 },
    { hour: '18', kwh: 2.1 },
  ];
</script>

<section>
  <h2>Compare</h2>
  <p>Period selector, ranked results, and usage-shape chart — coming soon.</p>
  <div style="height:220px">
    <Chart
      {data}
      x="hour"
      xScale={scaleBand().padding(0.2)}
      y="kwh"
      yScale={scaleLinear()}
      yDomain={[0, null]}
      padding={{ left: 28, bottom: 24 }}
    >
      <Svg>
        <Axis placement="left" />
        <Axis placement="bottom" />
        <Bars />
      </Svg>
    </Chart>
  </div>
</section>
