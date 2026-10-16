export const initialArchive = [
  {
    id: 'nutrient-ratio',
    category: '양액 비율',
    title: '양액 비율',
    content: '',
  },
  {
    id: 'filter-cleaning',
    category: '필터 청소',
    title: '필터 청소 안내',
    content: `실제 차단기·밸브 위치와 순서는 현장에서 확인해 주세요.

재배실 소형 필터(리턴펌프)
1. 재배실 판넬 전원 차단기 OFF (1번·2번 판넬)
2. 필터 2개 청소 후 전원 차단기 ON
3. 물이 새는지 확인

유틸리티실 양액 소형 필터
1. 유틸리티실 전원 배전판 밸브 OFF
2. 물탱크 메인 물밸브와 양액통 안의 밸브를 잠그고 필터 청소
3. 청소 후 물탱크 메인 물밸브 열기
4. 전원 배전판 밸브 ON, 물이 새는지 확인

재배실 대형 필터
1. 유틸리티실 전원 배전판 밸브 OFF
2. 물탱크 메인 물밸브 잠그고 필터 청소 (1시간 안에 완료)
3. 청소 후 물탱크 메인 물밸브 열기
4. 전원 배전판 밸브 ON, 물이 새는지 확인`,
  },
];

export function archiveValues(body) {
  const category = String(body.category ?? '').trim();
  const title = String(body.title ?? '').trim();
  const content = String(body.content ?? '').trim();
  if (!category || !title) throw new Error('분류와 제목을 입력해 주세요.');
  if (category.length > 50 || title.length > 100 || content.length > 5000) throw new Error('아카이브 내용이 너무 깁니다.');
  return { category, title, content };
}
