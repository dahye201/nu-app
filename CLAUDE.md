# nu. — 인터스티셜 저널링 앱

ADHD 사용자를 위한 초간단 저널링 앱. 지금 하고 있는 일을 타임스탬프와 기분 이모지와 함께 빠르게 기록한다.
앱 이름 "nu"는 네덜란드어로 "지금"이라는 뜻.

## 제품 원칙 (가장 중요)
- **마찰 최소화가 최우선.** ADHD 사용자는 작은 마찰만 있어도 앱을 안 쓴다. 단계, 팝업, 필수 입력을 늘리는 변경은 하기 전에 먼저 물어볼 것.
- **로그인 기능 넣지 말 것.** 계정 없이 바로 쓰는 게 핵심이다.
- **타임스탬프는 수정 불가.** 인터스티셜 저널링은 쓰는 그 순간을 기록하는 방식이다. 기록 내용 수정·삭제는 되지만 시간은 바꿀 수 없다.

## 무료 / 프리미엄
- 프리미엄은 **일회성 결제** (구독 아님)
- 프리미엄 기능: 컬러 테마, 지난 기록을 보는 History 캘린더, 리마인더 시간 직접 설정
- 무료: 오늘 기록만 볼 수 있음 (이전 기록은 프리미엄 잠금), 하루 2번 랜덤 리마인더
- 시즌 테마(크리스마스 등)는 기간 한정으로 모두에게 무료 공개할 수 있음
- 무료/프리미엄 경계를 바꾸는 변경은 먼저 물어볼 것

## 다국어
- 지원 언어: 영어(기본), 한국어. 네덜란드어 추가 검토 중
- **UI 문자열을 추가하거나 바꿀 때는 모든 언어 파일을 같이 업데이트할 것.** 한쪽만 바꾸지 말 것.
- 한국어는 직역 말고 자연스러운 표현으로 쓸 것. 메인 프롬프트처럼 짧은 문구는 대안을 2~3개 제안해줘.

## 보안
- `.env`, API 키, 인증서, 키스토어 파일은 **절대 커밋하지 말 것.** 커밋 전에 `git status`로 확인하고, 이런 파일이 보이면 멈추고 알려줘.
- `.gitignore`에 위 파일들이 포함돼 있는지 확인할 것.

## 작업 방식
- 여러 파일을 건드리는 기능은 먼저 계획을 보여주고 승인받은 다음 진행할 것.
- 기존 디자인과 톤을 유지할 것: 미니멀하고 조용한 스타일.
- 커밋 메시지는 영어로, 짧고 명확하게.

## 기술 스택
- **플랫폼:** iOS 전용. Capacitor 8로 감싼 웹앱 (`appId: com.dadahuis.nu`)
- **프론트엔드:** 프레임워크 없는 바닐라 JS (ES 모듈). esbuild로 `src/app.js` → `www/bundle.js` 번들링
- **저장소:** 기록은 `localStorage` (`ij_YYYY_M_D` 키). WebKit이 지울 수 있어서 네이티브 파일에 복사본을 둠 (`journalMirror.js` ↔ `NuJournalPlugin`)
- **네이티브 (Swift):** `ios/App/App/`에 있음. `NuReminders.swift`(알림 + 저널 파일 플러그인), `MainViewController.swift`, `AppDelegate.swift`
- **결제:** RevenueCat (`@revenuecat/purchases-capacitor`). 엔타이틀먼트 `premium`, 상품 `nu.premium.lifetime`
- **기타 플러그인:** `@capacitor/filesystem`, `haptics`, `share`

### 폴더 구조
- `src/`: 앱 소스
  - `app.js`: 진입점, 메인 화면
  - `i18n.js`: 영어/한국어 문자열 (`en`, `ko` 객체)
  - `reminders.js`, `backup.js`, `entryActions.js`, `journalMirror.js`, `deletedReplies.js`, `purchaseService.js`
  - `config.js`: RevenueCat 키. gitignore 대상이라 `config.example.js`를 복사해서 만듦
- `www/`: `index.html`, 시즌 테마 SVG (`seasonal/`). `bundle.js`는 빌드 결과물이라 커밋하지 않음
- `ios/`: Xcode 프로젝트
- `tests/`: headless Chrome(puppeteer-core) UI/로직 테스트. web 빌드와 native 빌드(`mock-capacitor.js`)를 둘 다 테스트함
- `docs/`: 지원 페이지 + 개인정보처리방침
- `resources/`: 아이콘, 스토어 스크린샷

### 명령어
- `npm run build`: 번들 빌드
- `npm run watch`: 파일 바뀔 때마다 다시 빌드
- `npm run sync`: 빌드한 다음 `cap sync ios`
- `npm test`: 테스트 실행 (Chrome 필요. 다른 위치에 있으면 `CHROME_PATH` 지정)

### 배포
- Codemagic (`codemagic.yaml`의 `ios-release`)으로 TestFlight에 올림
- CI가 시크릿(`nu_secrets` 그룹)으로 `src/config.js`를 만들고, 빌드 번호를 최신 TestFlight 빌드 + 1로 자동 설정함
