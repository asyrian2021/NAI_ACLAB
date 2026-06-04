# NAI Artist Combination Lab

NovelAI 이미지 생성에서 작가 태그 조합과 가중치를 실험하기 위한 로컬 웹앱입니다.  
작가 태그의 가중치를 랜덤하게 바꿔 여러 이미지를 만들고, 마음에 드는 결과에서 작가 가중치를 다시 불러와 고정한 뒤 여러 프리셋 조합을 테스트할 수 있습니다.

## 설치와 실행

### npm으로 실행 (권장)

Windows 실행 파일의 SmartScreen/보안 경고가 부담스럽다면 npm 방식으로 실행하는 것을 권장합니다.

필요한 것:

- Node.js 18 이상
- Python 3.10 이상

실행 방법:

```powershell
npm start
```

GitHub에서 처음 받은 뒤에는 프로젝트 폴더에서 위 명령을 실행하면 됩니다. 브라우저가 자동으로 열리고, 앱 사용을 마친 뒤 안내 창을 닫으면 서버가 종료됩니다.

npm 패키지로 공개한 뒤에는 아래처럼 바로 실행할 수 있습니다.

```powershell
npx nai-aclab
```

### Windows 배포판

Releases의 `NAI-Artist-Lab-windows.zip`을 사용할 수도 있습니다. 다만 서명되지 않은 실행 파일이기 때문에 Windows 보안 경고가 표시될 수 있습니다.

1. Releases에서 `NAI-Artist-Lab-windows.zip`을 다운로드합니다.
2. 원하는 폴더에 압축을 풉니다.
3. `NAI Artist Lab.exe`를 실행합니다.
4. 브라우저가 자동으로 열리면 앱을 사용합니다.

### Python으로 직접 실행

Python 3.10 이상이 설치되어 있다면 npm 없이도 소스 코드로 실행할 수 있습니다.

```powershell
python launcher.py
```

브라우저 서버만 직접 실행하려면 아래 명령을 사용합니다.

```powershell
python web_app.py
```

기본 주소는 `http://127.0.0.1:8765`입니다.

## 기본 사용 흐름

1. `API 설정` 메뉴에서 NovelAI 토큰과 모델 설정을 입력합니다.
2. `작가 태그` 메뉴에서 카테고리별 작가 태그 목록과 가중치 범위를 설정합니다.
3. `프리셋` 메뉴에서 베이스 프롬프트, 퀄리티 프롬프트, 캐릭터 프롬프트를 저장합니다.
4. `생성` 메뉴에서 베이스+퀄리티 프리셋과 캐릭터 프리셋을 고르고 이미지를 생성합니다.
5. `히스토리` 또는 `가중치 비교`에서 마음에 드는 이미지의 `가중치 불러오기`를 누릅니다.
6. 고정된 작가 가중치로 다시 생성하거나, `타율 테스트`에서 여러 씬을 한 번에 테스트합니다.

## 주요 기능

- 작가 태그 카테고리별 랜덤 선택
- 카테고리별 가중치 범위와 granule 설정
- 선택 태그 수 설정
- `1.3::artist:example ::` 형식의 작가 가중치 프롬프트 생성
- 기존 프롬프트에서 붙여넣은 `artist:*` 태그 자동 인식
- 베이스 프롬프트와 퀄리티 프롬프트 프리셋 저장
- 공용 퀄리티 프롬프트 override
- 최대 3명 캐릭터 프롬프트 저장
- 네거티브 프롬프트와 UC 프롬프트 분리 관리
- Normal Portrait, Landscape, Square 이미지 크기 선택
- 실시간 이미지 미리보기
- 생성 히스토리 저장
- 히스토리 선택 삭제와 전체 삭제
- 이미지 확대 보기, 좌우 이동, 휠 확대/축소, 드래그 이동
- 작가 가중치 비교
- 이상형 월드컵
- 마음에 드는 이미지의 작가 가중치 불러오기
- 타율 테스트

## 작가 태그 입력

작가 태그는 한 줄에 하나씩 넣어도 되고, 기존에 쓰던 프롬프트 조각을 그대로 붙여넣어도 됩니다.

```text
artist:example_main
artist:sample_a
```

또는:

```text
1.3::artist:example_alpha ::, 1.1::artist:example_beta ::, 0.8::artist:example_gamma ::,
```

앱은 여기서 `artist:*` 부분만 자동으로 인식합니다.

## 프롬프트 조립 순서

최종 프롬프트는 아래 순서로 만들어집니다.

```text
베이스 프롬프트, 작가 태그, 퀄리티 프롬프트 | 캐릭터 1 | 캐릭터 2 | 캐릭터 3
```

퀄리티 프롬프트 override가 비어 있으면 선택한 베이스+퀄리티 프리셋의 퀄리티 프롬프트를 사용합니다.  
override가 입력되어 있으면 모든 프리셋 조합에서 override 값을 우선 사용합니다.

## 타율 테스트

타율 테스트는 고정된 작가 가중치가 여러 프리셋 조합에서 얼마나 안정적으로 잘 나오는지 확인하는 기능입니다.

여기서 씬은 아래 조합을 뜻합니다.

```text
씬 = 베이스+퀄리티 프리셋 + 캐릭터 프리셋 + 생성 개수
```

사용 방법:

1. 히스토리나 가중치 비교에서 마음에 드는 이미지의 `가중치 불러오기`를 누릅니다.
2. `타율 테스트` 메뉴로 이동합니다.
3. `현재 조합으로 씬 추가`를 눌러 테스트할 씬을 여러 개 등록합니다.
4. 각 씬의 프리셋과 생성 개수를 조정합니다.
5. `타율 테스트 시작`을 누릅니다.

결과는 히스토리에 `타율 테스트` 묶음으로 저장되며, 각 이미지에는 사용된 씬 이름과 프리셋 정보가 함께 남습니다.

## API 설정

`API 설정` 메뉴에서 다음 값을 설정합니다.

- API 토큰
- Endpoint
- Model
- Steps
- Scale
- Guidance Rescale
- Sampler
- Noise Schedule
- Seed
- UC 프롬프트
- 네거티브 프롬프트

토큰을 넣기 전에는 목업 모드로 UI 흐름을 먼저 테스트할 수 있습니다.

## 저장 위치

소스/Python 실행 시:

- 앱 상태: `data/app_state.json`
- 생성 이미지와 요청 JSON: `outputs/`

`npm start` 실행 시:

- Windows: `%APPDATA%\NAI Artist Combination Lab`
- macOS: `~/Library/Application Support/NAI Artist Combination Lab`
- Linux: `~/.local/share/nai-artist-combination-lab`

Windows 배포판 실행 시:

- 실행 파일 옆에 `data/`와 `outputs/` 폴더가 생성됩니다.

저장 위치를 직접 지정하려면 `NAI_ARTIST_LAB_USER_DIR` 환경 변수를 설정하면 됩니다.

## 참고

NovelAI V4+의 멀티 캐릭터 프롬프트는 캐릭터 프롬프트를 쉼표로 합치지 않고 `|`로 분리합니다.

예시:

```text
2girls, outdoors, best quality | girl, black hair | girl, blonde hair
```
