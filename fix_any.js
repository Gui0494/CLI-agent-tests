const fs = require('fs');
const path = require('path');

function walkSync(dir, filelist = []) {
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (fs.statSync(dirFile).isDirectory()) {
      if (!dirFile.includes('node_modules') && !dirFile.includes('dist')) {
        filelist = walkSync(dirFile, filelist);
      }
    } else {
      if (dirFile.endsWith('.ts')) filelist.push(dirFile);
    }
  });
  return filelist;
}

const files = walkSync('src').concat(walkSync('tests'));

let changed = 0;
files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    let original = content;
    
    // Replace catch (e: any) { e.message } with catch (e: unknown) { (e as Error).message }
    // This is a naive but effective regex for the common pattern in this codebase.
    
    // 1. Change catch (e: any) to catch (e: unknown)
    content = content.replace(/catch\s*\(\s*([a-zA-Z0-9_]+)\s*:\s*any\s*\)/g, 'catch ($1: unknown)');
    
    // 2. We must cast generic usages of that error variable to Error where .message is used
    // This might be tricky if variable name varies, but we know standard names are 'e' or 'err'.
    content = content.replace(/\be\.message\b/g, '(e as Error).message');
    content = content.replace(/\berr\.message\b/g, '(err as Error).message');
    
    // 3. Optional: replace Promise.race as any
    content = content.replace(/as any/g, 'as unknown');
    
    if (content !== original) {
        fs.writeFileSync(f, content, 'utf8');
        changed++;
    }
});

console.log(`Updated ${changed} files.`);
