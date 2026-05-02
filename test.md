# Shadcn Layout Architect (가칭)
 "모든 페이지에 같은 설정을 강요하지 마세요. 레이아웃의 목적에 맞는 최적의 UI 시스템을 구축합니다."
# 1. 핵심 비전
 - Contextual UI: 대시보드, 쇼핑몰, 랜딩 등 목적에 따른 레이아웃 프리셋 제공.
 - Visual Validation: 변수 변경 시 여러 레이아웃에 반영되는 모습을 한 화면에서 동시 비교.
 - Design-as-Code: globals.css, tailwind.config.js, DESIGN.md 자동 생성.
# 2. 제품 구조 (Product Architecture)
## 2.1. 3계층 테마 엔진
 1. Global Layer (Root): 프로젝트 전체의 기본 컬러, 폰트, 기본 Radius 설정.
 2. Context Layer (Overrides): .layout-dashboard, .layout-shopping 등 클래스별 오버라이드 변수 정의.
 3. Component Layer: Shadcn 컴포넌트가 상위 클래스에 따라 가변적으로 렌더링.
## 2.2. 주요 기능 모듈
 - Multi-View Canvas: 4~5개의 대표 레이아웃을 한꺼번에 렌더링하는 메인 화면.
 - Smart Variable Slider: 'Density', 'Softness' 등 직관적 키워드로 변수 조절.
 - Documentation Engine: 디자인 결정 사항을 분석하여 DESIGN.md로 변환.
# 3. 개발 로드맵 (Roadmap)
## 1단계: MVP 개발 (Foundation)
 - UI 템플릿 구축: 5가지 핵심 레이아웃(대시보드, 쇼핑몰, 로그인 등) 제작.
 - 실시간 인젝터: 유저 선택 변수를 style 태그를 통해 실시간 주입.
 - 다크모드 시뮬레이션: 레이아웃별 다크모드 대응 확인.
## 2단계: 스마트 기능 추가 (Intelligence)
 - Layout Specific Config: 특정 레이아웃 전용 독립 변수 설정.
 - Dynamic Data Toggle: 실제 데이터(가짜 데이터) 시뮬레이션 버튼.
 - Export 시스템: globals.css 및 tailwind.config.js 패키지 다운로드.
## 3단계: 생태계 확장 (Ecosystem)
 - DESIGN.md 생성기: 선택 프리셋의 논리적 근거 자동 작성.
 - v0.dev 연동: 생성된 테마 값을 AI UI 생성 도구에 바로 활용 지원.
# 4. 기술 스택 (Tech Stack)
 - Framework: Next.js 14+ (App Router)
 - UI Library: Shadcn UI (Radix UI)
 - Styling: Tailwind CSS
 - State Management: Zustand (실시간 상태 관리)
 - Sandboxing: CSS Scope Class (.layout-xxx) 적용
# 5. DESIGN.md 자동 생성 예시 (Output Sample)
 # 🎨 Project Design System Guidelines
 ## 1. Overview
 본 프로젝트는 레이아웃별로 차등화된 디자인 시스템을 적용합니다.
 ## 2. Layout Strategies
 ### 📊 Dashboard (.layout-dashboard)
 - Radius: 0.125rem (Sharp) - 데이터 가독성을 위해 곡률 최소화.
 - Spacing: p-2 / p-3 - 공간 효율 극대화.
 ### 🛍️ Shopping (.layout-shopping)
 - Radius: 1.0rem (Very Soft) - 상품 이미지가 돋보이는 부드러운 느낌.