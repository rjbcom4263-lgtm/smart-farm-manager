export function journalValues(body) {
  const date = String(body.date ?? '').trim();
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('올바른 날짜를 입력해 주세요.');
  }
  const title = String(body.title ?? '').trim();
  const content = String(body.content ?? '').trim();
  if (!title || !content) throw new Error('제목과 내용을 입력해 주세요.');
  if (title.length > 100 || content.length > 5000) throw new Error('업무 일지 내용이 너무 깁니다.');
  return { date, title, content };
}
