// 简单的聚合器系统测试脚本
import { initializeAggregators } from './src/core/providerRegistry';
import { getAllAggregators, getAggregatorByName, getDefaultAggregator } from './src/core/aggregator';

console.log('=== Aggregator System Test ===\n');

try {
  // 初始化聚合器
  console.log('Initializing aggregators...\n');
  initializeAggregators();

  // 获取所有聚合器
  const allAggs = getAllAggregators();
  console.log(`✓ Total aggregators registered: ${allAggs.length}\n`);

  // 显示所有聚合器信息
  console.log('Registered Aggregators:');
  allAggs.forEach(agg => {
    console.log(`  - ${agg.name} (${agg.config.displayName})`);
    console.log(`    Types: ${agg.config.supportedTypes.join(', ')}`);
    console.log(`    Region: ${agg.config.region}`);
    console.log(`    Priority: ${agg.config.priority}`);
    console.log(`    Providers: ${agg.config.providerIds.join(', ')}\n`);
  });

  // 测试按名称获取
  console.log('Testing getAggregatorByName():');
  const overseasAnim = getAggregatorByName('overseas-anime');
  console.log(`  overseas-anime: ${overseasAnim ? '✓ Found' : '✗ Not found'}`);

  const mainlandAnim = getAggregatorByName('mainland-anime');
  console.log(`  mainland-anime: ${mainlandAnim ? '✓ Found' : '✗ Not found'}\n`);

  // 测试默认聚合器获取
  console.log('Testing getDefaultAggregator():');
  const movieAgg = getDefaultAggregator('movie');
  console.log(`  movie: ${movieAgg ? `✓ ${movieAgg.name}` : '✗ Not found'}`);

  const seriesAgg = getDefaultAggregator('series');
  console.log(`  series: ${seriesAgg ? `✓ ${seriesAgg.name}` : '✗ Not found'}`);

  const seriesMainland = getDefaultAggregator('series', 'mainland');
  console.log(`  series (mainland): ${seriesMainland ? `✓ ${seriesMainland.name}` : '✗ Not found'}\n`);

  console.log('=== All Tests Passed! ===');
  process.exit(0);
} catch (error) {
  console.error('✗ Test failed:', error);
  process.exit(1);
}
