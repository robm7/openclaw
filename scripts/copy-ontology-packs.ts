#!/usr/bin/env node
/**
 * Copy ontology packs from source to dist directory
 * Ensures dist/ontology-packs/ exists and is up-to-date after TypeScript build
 */

import { promises as fs } from "fs";
import { join } from "path";

async function copyOntologyPacks() {
  // SOURCE OF TRUTH: calibrated packs live in src/ontology-packs. Never copy from repo root.
  const srcDir = "src/ontology-packs";
  const destDirs = ["dist/ontology-packs", "dist/plugin-sdk/ontology-packs"];

  try {
    for (const destDir of destDirs) {
      // Ensure destination directory exists
      await fs.mkdir(destDir, { recursive: true });

      // Read all files from source directory
      const files = await fs.readdir(srcDir);

      // Copy each file
      for (const file of files) {
        const srcFile = join(srcDir, file);
        const destFile = join(destDir, file);

        // Check if it's a file (not a directory)
        const stat = await fs.stat(srcFile);
        if (stat.isFile()) {
          await fs.copyFile(srcFile, destFile);
        }
      }

      console.log(`✓ Copied ontology packs to ${destDir}`);
    }
  } catch (err) {

    console.error(`✗ Failed to copy ontology packs:`, err);
    process.exit(1);
  }
}

copyOntologyPacks();
