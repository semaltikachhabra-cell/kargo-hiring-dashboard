import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

export async function fileToText(name: string, buf: Buffer): Promise<string> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (lower.endsWith('.pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return buf.toString('utf8');
  throw new Error('Unsupported file type. Upload .docx, .pdf or .txt');
}
