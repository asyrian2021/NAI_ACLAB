# NAI Artist Combination Lab

NovelAI 이미지 생성용 작가 태그 조합과 가중치를 랜덤 실험하기 위한 GUI 프로그램입니다.

## 실행

Python 3.10 이상이 설치되어 있으면 추가 패키지 없이 실행할 수 있습니다.

```powershell
python app.py
```

브라우저 기반 새 UI는 아래처럼 실행합니다.

```powershell
python web_app.py
```

실행 후 `http://127.0.0.1:8765`로 접속하면 됩니다. 기존 `tkinter` 앱은 그대로 유지되어 있고, 웹 UI는 같은 `data/app_state.json`과 `outputs/`를 사용합니다.

배포용 런처는 로컬 서버를 시작한 뒤 브라우저를 자동으로 엽니다.

```powershell
python launcher.py
```

## 주요 기능

- 기본 카테고리:
  - 메인 그림체 작가: 가중치 1.0~1.4, granule 0.05
  - 그림체 안정화 작가: 가중치 0.4~0.9, granule 0.1
- 커스텀 작가 태그 카테고리 추가, 수정, 삭제
- 작가 태그 목록에는 `artist:name`만 한 줄씩 넣어도 되고, `1.3::artist:example_alpha ::, 1.1::artist:example_beta ::`처럼 기존 프롬프트 조각을 붙여넣어도 됩니다. 생성에는 인식된 `artist:*` 태그만 사용합니다.
- 카테고리별 `선택 태그 수` 설정: 빈칸이면 해당 카테고리의 작가 태그를 모두 포함하고, 숫자를 넣으면 프롬프트 1개마다 그 개수만큼만 랜덤으로 뽑습니다.
- 베이스 프롬프트 + 퀄리티 프롬프트 프리셋 저장
- 최대 3명 캐릭터 프롬프트 및 캐릭터별 네거티브 프롬프트 프리셋 저장
- 공통 네거티브 프롬프트와 API `parameters.uc`용 UC 프롬프트를 별도로 저장
- 최종 프롬프트 순서:
  - 베이스 프롬프트, 랜덤 생성 작가 태그, 퀄리티 프롬프트
  - `|`
  - 캐릭터 1 프롬프트
  - `|`
  - 캐릭터 2 프롬프트
  - `|`
  - 캐릭터 3 프롬프트
- 입력한 개수만큼 이미지 배치 생성
- 웹 UI 생성 탭에서 완료된 이미지를 실시간 라이브 갤러리로 표시
- 생성 탭에서 마지막으로 선택한 베이스 프리셋, 캐릭터 프리셋, 생성 개수 자동 복원
- 프리셋 조합별 생성 히스토리 저장
- 웹 UI `가중치 비교` 메뉴에서 생성 이미지별 작가태그 가중치를 가로 스크롤 카드와 매트릭스로 비교
- 웹 UI에서 히스토리 선택 삭제, 전체 삭제, 선택 시 출력 파일까지 삭제
- 히스토리 이미지 2장씩 랜덤 비교하는 이상형 월드컵
- 타율 테스트: 고정 작가태그 가중치를 유지한 채 여러 씬(베이스+퀄리티 프리셋 + 캐릭터 프리셋 조합)을 순서대로 생성

## NovelAI API 설정

`API 설정` 탭에서 토큰, endpoint, model, steps, scale, Guidance Rescale, sampler, Noise Schedule, seed를 설정합니다. 이미지 크기는 생성 메뉴에서 Normal Portrait, Landscape, Square 중 선택합니다.

기본 endpoint는 현재 NovelAI 이미지 생성 API 문서에서 안내되는 이미지 전용 도메인인 `https://image.novelai.net/ai/generate-image`를 사용합니다. 모델명과 payload 세부값은 NovelAI 측 변경 가능성이 있으므로 GUI에서 직접 바꿀 수 있게 두었습니다.

토큰을 넣기 전에는 `목업 모드`가 켜져 있으며, 이 경우 실제 API 호출 대신 테스트용 PNG를 저장합니다. 이 모드로 프롬프트 조합, 히스토리, 월드컵 흐름을 먼저 확인할 수 있습니다.

Guidance Rescale은 NovelAI API 요청의 `parameters.cfg_rescale` 값으로 전달됩니다.

V4/V4.5 요청은 `parameters.v4_prompt.caption.base_caption`, `parameters.v4_negative_prompt.caption.base_caption`, `parameters.uc`, `parameters.negative_prompt`, `parameters.request_type`을 포함하는 형태로 전송합니다. 캐릭터 프롬프트는 `|` 문법이 포함된 하나의 base caption 문자열로 유지하며, 예시 메타데이터와 같이 `char_captions`는 빈 배열로 둡니다. `parameters.uc`와 `parameters.negative_prompt`는 API 설정 탭의 UC 프롬프트 칸 값을 사용하고, UC 칸이 비어 있으면 공통 네거티브 프롬프트를 대신 사용합니다.

실제 전송 payload 확인을 위해 생성 이미지 옆에 `image_001_request.json` 형식의 요청 JSON을 함께 저장합니다.

Cloudflare `Error 1010: browser_signature_banned`가 발생하면 요청의 브라우저/클라이언트 서명이 차단된 것입니다. 기본 Python `urllib` User-Agent가 나가지 않도록 앱에서 브라우저형 User-Agent 헤더를 명시하며, 필요하면 API 설정 탭에서 다른 User-Agent 문자열로 바꿔 테스트할 수 있습니다.

## 저장 위치

- 앱 상태: `data/app_state.json`
- 생성 이미지 및 메타데이터 대상 폴더: `outputs/`

PyInstaller로 묶은 배포판에서는 실행 파일 옆에 `data/`와 `outputs/`가 생성됩니다.

## Windows 배포 파일 만들기

빌드에는 PyInstaller가 필요합니다.

```powershell
python -m pip install pyinstaller
.\scripts\build_windows.ps1
```

완료되면 `release/NAI-Artist-Lab-windows.zip` 파일이 만들어집니다. 사용자는 압축을 풀고 `NAI Artist Lab.exe`를 실행하면 됩니다.

## GitHub 업로드 주의사항

`data/`, `outputs/`, `release/`, `dist/`, `build/`는 `.gitignore`에 포함되어 있습니다. `data/app_state.json`에는 API 토큰, 프롬프트, 히스토리가 들어갈 수 있으므로 절대 공개 저장소에 올리지 마세요.

## 참고

작가 태그는 현재 `1.3::artist:0jae ::` 형식으로 최종 프롬프트에 들어갑니다. NovelAI에서 선호하는 가중치 표기 방식이 다르다면 `app.py`의 `weight_tag()` 함수만 바꾸면 전체 앱에 반영됩니다.

NovelAI V4+의 멀티 캐릭터 프롬프트는 캐릭터 프롬프트를 쉼표로 합치지 않고 `|`로 분리합니다. 예를 들어 `2girls, outdoors, best quality | girl, black hair | girl, blonde hair`처럼 만들어집니다.
