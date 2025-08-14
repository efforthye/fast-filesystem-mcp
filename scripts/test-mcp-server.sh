#!/bin/bash

# Fast Filesystem MCP Server Test Script
# 배포된 MCP 서버의 모든 기능을 테스트합니다

SERVER_URL="https://fast-filesystem-mcp.vercel.app/api/server"
SLEEP_TIME=1

echo "🚀 Fast Filesystem MCP Server 테스트 시작"
echo "서버 URL: $SERVER_URL"
echo "=========================="

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 테스트 함수
test_endpoint() {
    local test_name="$1"
    local method="$2"
    local data="$3"
    
    echo -e "\n${BLUE}📋 테스트: $test_name${NC}"
    echo "-----------------------------------"
    
    if [ "$method" = "GET" ]; then
        echo "요청: curl -X GET $SERVER_URL"
        response=$(curl -s -X GET "$SERVER_URL")
    else
        echo "요청: curl -X POST $SERVER_URL"
        echo "데이터: $data"
        response=$(curl -s -X POST "$SERVER_URL" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    echo -e "\n${GREEN}응답:${NC}"
    echo "$response" | jq '.' 2>/dev/null || echo "$response"
    
    sleep $SLEEP_TIME
}

# 1. 서버 상태 확인
test_endpoint "서버 상태 확인" "GET"

# 2. MCP 초기화
test_endpoint "MCP 초기화" "POST" '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {
            "name": "test-client",
            "version": "1.0.0"
        }
    }
}'

# 3. 도구 목록 조회
test_endpoint "도구 목록 조회" "POST" '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
}'

# 4. 허용된 디렉토리 조회
test_endpoint "허용된 디렉토리 조회" "POST" '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
        "name": "fast_list_allowed_directories",
        "arguments": {}
    }
}'

# 5. /tmp 디렉토리 조회
test_endpoint "/tmp 디렉토리 조회" "POST" '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
        "name": "fast_list_directory",
        "arguments": {
            "path": "/tmp"
        }
    }
}'

# 6. /tmp 디렉토리 정보 조회
test_endpoint "/tmp 디렉토리 정보 조회" "POST" '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
        "name": "fast_get_file_info",
        "arguments": {
            "path": "/tmp"
        }
    }
}'

# 7. 디스크 사용량