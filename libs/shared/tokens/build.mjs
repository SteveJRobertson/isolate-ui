#!/usr/bin/env node
import StyleDictionary from 'style-dictionary';
import config from './config.mjs';

/**
 * Build script for Style Dictionary tokens
 * Generates CSS variables and TypeScript definitions from design tokens
 */
async function build() {
  console.log('Building design tokens...\n');

  try {
    const sd = new StyleDictionary(config);
    await sd.buildAllPlatforms();

    console.log('\n✅ Design tokens built successfully!');
    console.log('   - CSS variables: libs/shared/tokens/gen/css/variables.css');
    console.log('   - TypeScript:    libs/shared/tokens/gen/ts/tokens.ts');
  } catch (error) {
    console.error('❌ Error building design tokens:', error);
    process.exit(1);
  }
}

build();
