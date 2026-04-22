import fs from 'fs';
import path from 'path';

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(path.join(dir, file));
    if (stat.isDirectory()) {
      getAllFiles(path.join(dir, file), fileList);
    } else if (file.endsWith('.ts')) {
      fileList.push(path.join(dir, file));
    }
  }
  return fileList;
}

const files = getAllFiles('packages/renderer/src/visualizers');
const hsvRegex = /vec3\s+hsv2rgb\s*\(\s*vec3\s+[a-zA-Z0-9_]+\s*\)\s*\{[\s\S]*?return\s+[^;]+;[\s\S]*?\}/;

let modifiedCount = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;

  content = content.replace(/new\s+THREE\.ShaderMaterial\s*\(/g, 'new THREE.RawShaderMaterial(');

  const vertexShaderMatch = content.match(/const\s+VERTEX_SHADER\s*=\s*\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`/);
  if (vertexShaderMatch) {
    let vs = vertexShaderMatch[1];
    if (!vs.includes('attribute vec3 position;')) {
      const lines = vs.split(String.fromCharCode(10));
      let insertIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().length > 0 && !lines[i].includes('precision')) {
          insertIdx = i;
          break;
        }
      }
      lines.splice(insertIdx, 0, '  attribute vec3 position;', '  attribute vec2 uv;');
      const newVs = lines.join(String.fromCharCode(10));
      content = content.replace(vertexShaderMatch[1], newVs);
    }
  }

  if (hsvRegex.test(content)) {
    content = content.replace(hsvRegex, '#include <cyber_hsv2rgb>');
  }

  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    modifiedCount++;
  }
}
console.log(`Refactored ${modifiedCount} visualizers.`);