"use strict";
{
    name: 'fast_checkpoint_write_file',
        description;
    '체크포인트 기반 대용량 파일 안전 작성 (중단 복구 가능, 이모지 제거 옵션)',
        inputSchema;
    {
        type: 'object',
            properties;
        {
            path: {
                type: 'string', description;
                '파일 경로';
            }
            sections: {
                type: 'array',
                    description;
                '섹션 배열',
                    items;
                {
                    type: 'object',
                        properties;
                    {
                        id: {
                            type: 'string', description;
                            '섹션 ID';
                        }
                        name: {
                            type: 'string', description;
                            '섹션 이름';
                        }
                        content: {
                            type: 'string', description;
                            '섹션 내용';
                        }
                    }
                    required: ['id', 'name', 'content'];
                }
            }
            options: {
                type: 'object',
                    description;
                '작성 옵션',
                    properties;
                {
                    enable_emojis: {
                        type: 'boolean', description;
                        '이모지 허용', ;
                        false;
                    }
                    checkpoint_interval: {
                        type: 'number', description;
                        '체크포인트 간격', ;
                        1;
                    }
                    auto_backup: {
                        type: 'boolean', description;
                        '자동 백업', ;
                        true;
                    }
                    verify_write: {
                        type: 'boolean', description;
                        '작성 검증', ;
                        true;
                    }
                    max_retries: {
                        type: 'number', description;
                        '최대 재시도', ;
                        3;
                    }
                    mode: {
                        type: 'string', ;
                        let ;
                        (function () {
                        })( || ( = {}));
                        ['write', 'append'], description;
                        '작성 모드', ;
                        'write';
                    }
                }
            }
        }
        required: ['path', 'sections'];
    }
}
{
    name: 'fast_checkpoint_status',
        description;
    '체크포인트 상태 확인',
        inputSchema;
    {
        type: 'object',
            properties;
        {
            path: {
                type: 'string', description;
                '파일 경로';
            }
        }
        required: ['path'];
    }
}
{
    name: 'fast_checkpoint_continue',
        description;
    '체크포인트에서 이어서 작성',
        inputSchema;
    {
        type: 'object',
            properties;
        {
            path: {
                type: 'string', description;
                '파일 경로';
            }
        }
        required: ['path'];
    }
}
{
    name: 'fast_checkpoint_reset',
        description;
    '체크포인트 초기화',
        inputSchema;
    {
        type: 'object',
            properties;
        {
            path: {
                type: 'string', description;
                '파일 경로';
            }
        }
        required: ['path'];
    }
}
//# sourceMappingURL=checkpoint-tools.js.map