// 生成第二阶段夹具：EPUB / DOCX / XLSX / PPTX / slides.md
// 全部用已安装的纯 JS 依赖生成（JSZip/SheetJS），保证可复现
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'test', 'fixtures');
const JSZip = require('jszip');
const XLSX = require('xlsx');

// ---------- EPUB（最小合法结构：container → OPF → 2 章 + NCX） ----------
async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>LEA 测试电子书</dc:title>
    <dc:creator>UR Fixtures</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789012</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/><itemref idref="c2"/>
  </spine>
</package>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:12345678-1234-1234-1234-123456789012"/></head>
  <docTitle><text>测试电子书</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>第一章：开始阅读</text></navLabel><content src="chapter1.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>第二章：继续阅读</text></navLabel><content src="chapter2.xhtml"/></navPoint>
  </navMap>
</ncx>`);
  zip.file('OEBPS/chapter1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章：开始阅读</h1><p>这是 EPUB 渲染测试的<b>第一章</b>内容。</p>
<p>如果你能正常看到本章文字与样式，说明 EPUB 解析（容器 → OPF → spine → 章节渲染）已经生效。</p></body></html>`);
  zip.file('OEBPS/chapter2.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body><h1>第二章：继续阅读</h1><p>第二章验证目录跳转与多章节翻页。</p>
<ul><li>目录来自 NCX navMap</li><li>章节序号即阅读进度</li></ul></body></html>`);
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(join(dir, 'sample.epub'), buf);
}

// ---------- DOCX（最小 OOXML，mammoth 可解析） ----------
function makeDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>LEA DOCX 测试</w:t></w:r></w:p>
    <w:p><w:r><w:t>这一段由 mammoth 转换为 HTML。</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗文本</w:t></w:r><w:r><w:t> 与普通文本混合。</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>二级标题</w:t></w:r></w:p>
    <w:p><w:r><w:t>文档结尾。</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then((b) => writeFileSync(join(dir, 'sample.docx'), b));
}

// ---------- XLSX（SheetJS 生成，2 个工作表） ----------
function makeXlsx() {
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['姓名', '科目', '分数'],
    ['张三', '数学', 92], ['李四', '数学', 85], ['王五', '数学', 78],
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['城市', '人口'],
    ['北京', 2189], ['上海', 2487], ['深圳', 1749],
  ]);
  XLSX.utils.book_append_sheet(wb, ws1, '成绩');
  XLSX.utils.book_append_sheet(wb, ws2, '城市');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(join(dir, 'sample.xlsx'), buf);
}

// ---------- PPTX（最小结构，2 页文本幻灯片，本渲染器可解析） ----------
async function makePptx() {
  const zip = new JSZip();
  const slideXml = (title, body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:sp><p:txBody>
      <a:p><a:r><a:rPr b="1"/><a:t>${title}</a:t></a:r></a:p>
      ${body.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('\n      ')}
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
  <p:sldId id="257" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldIdLst>
</p:presentation>`);
  zip.file('ppt/slides/slide1.xml', slideXml('勾股定理', ['直角三角形：a² + b² = c²', '本页为 PPTX 基础预览测试']));
  zip.file('ppt/slides/slide2.xml', slideXml('第二章', ['内容页测试：文本提取', '动画与精确排版不在范围内']));
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(join(dir, 'sample.pptx'), buf);
}

// ---------- slides.md ----------
writeFileSync(join(dir, 'sample.slides.md'), `# LEA 幻灯片

用 reveal.js 渲染的 Markdown 幻灯片

* 方向键翻页
* 按 Esc 进入总览

---

## 第二页：代码与列表

\`\`\`js
console.log('hello slides');
\`\`\`

1. 每页由 --- 分隔
2. 支持 Markdown 全部语法

---

## 第三页：结束

* 谢谢观看
`);

// ---------- ODS（SheetJS 写出） ----------
function makeOds() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['城市', '人口'], ['北京', 2189], ['上海', 2487]]), '数据');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'ods' });
  writeFileSync(join(dir, 'sample.ods'), buf);
}
makeOds();

// ---------- ODT（最小 ODF：content.xml 文本层） ----------
function makeOdt() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`);
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body><office:text>
    <text:h text:outline-level="1">LEA ODT 测试</text:h>
    <text:p>这是 ODT 基础预览的段落，验证 ODF 文本层提取。</text:p>
    <text:h text:outline-level="2">小节</text:h>
    <text:list><text:list-item><text:p>列表项一</text:p></text:list-item><text:list-item><text:p>列表项二</text:p></text:list-item></text:list>
    <text:p>文档结束。</text:p>
  </office:text></office:body>
</office:document-content>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then((b) => writeFileSync(join(dir, 'sample.odt'), b));
}
await makeOdt();

await makeEpub();
await makeDocx();
makeXlsx();
await makePptx();
mkdirSync(dir, { recursive: true });
console.log('第二阶段夹具生成完成');
