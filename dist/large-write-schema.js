"use strict";
{
    name: 'fast_large_write_file',
        description;
    '대용량 파일을 안정적으로 작성합니다 (스트리밍, 재시도, 백업, 검증 기능)',
        inputSchema;
    {
        type: 'object',
            properties;
        {
            path: {
                type: 'string', description;
                '파일 경로';
            }
            content: {
                type: 'string', description;
                '파일 내용';
            }
            encoding: {
                type: 'string', description;
                '텍스트 인코딩', ;
                'utf-8';
            }
            create_dirs: {
                type: 'boolean', description;
                '디렉토리 자동 생성', ;
                true;
            }
            append: {
                type: 'boolean', description;
                '추가 모드', ;
                false;
            }
            chunk_size: {
                type: 'number', description;
                '청크 크기 (바이트)', ;
                65536;
            }
            backup: {
                type: 'boolean', description;
                '기존 파일 백업 생성', ;
                true;
            }
            retry_attempts: {
                type: 'number', description;
                '재시도 횟수', ;
                3;
            }
            verify_write: {
                type: 'boolean', description;
                '작성 후 검증', ;
                true;
            }
        }
        required: ['path', 'content'];
    }
}
//# sourceMappingURL=large-write-schema.js.map