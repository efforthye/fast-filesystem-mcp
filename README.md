# Fast Filesystem MCP Server

로컬에서 실행되는 고성능 파일시스템 MCP 서버로, Claude Desktop과 함께 사용할 수 있는 고급 파일 작업 기능을 제공합니다.

## 기능

- 파일 읽기/쓰기 (청킹 지원)
- 디렉토리 탐색 및 페이징
- 파일/디렉토리 검색 (이름 및 내용)
- 디렉토리 트리 구조 표시
- 대용량 파일 검색
- 디스크 사용량 조회
- Claude 최적화된 응답 크기 제한

## 설치

```bash
npm install -g fast-filesystem-mcp
```

또는 로컬에서 빌드:

```bash
git clone https://github.com/efforthye/fast-filesystem-mcp.git
cd fast-filesystem-mcp
npm install
npm run build
```

## Claude Desktop 설정

Claude Desktop의 설정 파일에 다음을 추가하세요:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "fast-filesystem-mcp"
    }
  }
}
```

로컬 빌드를 사용하는 경우:

```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "node",
      "args": ["/path/to/fast-filesystem-mcp/index.js"]
    }
  }
}
```

## 사용 가능한 도구

- `fast_list_allowed_directories` - 허용된 디렉토리 목록 조회
- `fast_read_file` - 파일 읽기 (청킹 지원)
- `fast_write_file` - 파일 쓰기/수정
- `fast_list_directory` - 디렉토리 목록 조회 (페이징)
- `fast_get_file_info` - 파일/디렉토리 정보 조회
- `fast_create_directory` - 디렉토리 생성
- `fast_search_files` - 파일 검색 (이름/내용)
- `fast_get_directory_tree` - 디렉토리 트리 구조
- `fast_get_disk_usage` - 디스크 사용량 조회
- `fast_find_large_files` - 대용량 파일 검색

## 보안

기본적으로 다음 디렉토리에만 접근 가능합니다:
- 홈 디렉토리 (`$HOME`)
- `/tmp`
- `/Users` (macOS)
- `/home` (Linux)

제외되는 디렉토리/파일:
- `node_modules`, `.git`, `.venv` 등
- 시스템 캐시 및 빌드 디렉토리

## 개발

```bash
npm run dev    # 개발 모드
npm run build  # 빌드
npm run start  # 실행
```

## 라이선스

MIT