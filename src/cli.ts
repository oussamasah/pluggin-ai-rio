import * as readline from 'readline';
import { runRIO } from './graph/graph';
import { logger } from './core/logger';
import mongoose from 'mongoose';
import { config } from './core/config';

async function initCLI() {
  await mongoose.connect(config.mongodb.uri, {
    dbName: config.mongodb.dbName,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n🚀 RIO CLI - Relational Intelligence Orchestrator\n');
  console.log('Type your query or "exit" to quit\n');

  const askQuestion = () => {
    rl.question('RIO > ', async (input) => {
      const query = input.trim();

      if (query.toLowerCase() === 'exit') {
        console.log('\nGoodbye! 👋\n');
        rl.close();
        await mongoose.disconnect();
        process.exit(0);
      }

      if (!query) {
        askQuestion();
        return;
      }

      try {
        console.log('\n⏳ Processing...\n');

        const result = await runRIO(query, 'cli-user', undefined);

        console.log('━'.repeat(80));
        console.log('📊 ANSWER:\n');
        console.log(result.finalAnswer);
        console.log('\n━'.repeat(80));
        console.log(`\n✓ Confidence: ${(result.confidence * 100).toFixed(1)}%`);
        console.log(`✓ Execution Time: ${Date.now() - result.startTime}ms`);
        console.log(`✓ Iterations: ${result.iterations}`);
        console.log(`✓ Data Retrieved: ${result.flattenedData.length} documents\n`);

        if (result.errors.length > 0) {
          console.log('⚠️  Errors:');
          result.errors.forEach(err => console.log(`   - ${err}`));
          console.log('');
        }
      } catch (error: any) {
        console.error('\n❌ Error:', error.message, '\n');
      }

      askQuestion();
    });
  };

  askQuestion();
}

if (require.main === module) {
  initCLI().catch(console.error);
}