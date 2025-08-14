// ========================================
// 체크포인트 기반 대용량 파일 작성 시스템
// 중단된 작성을 안전하게 복구하고 계속 진행
// ========================================

import { promises as fs } from 'fs';
import path from 'path';

interface CheckpointData {
  targetFile: string;
  totalSections: number;
  completedSections: string[];
  currentSection: number;
  timestamp: string;
  fileSize: number;
  lastLineCount: number;
  mode: 'write' | 'append';
}

interface Section {
  id: string;
  name: string;
  content: string;
  lineCount: number;
  size: number;
}

interface SafeWriteOptions {
  enableEmojis?: boolean;
  checkpointInterval?: number;
  autoBackup?: boolean;
  verifyWrite?: boolean;
  maxRetries?: number;
}

export class SafeLargeFileWriter {
  private targetPath: string;
  private checkpointPath: string;
  private backupPath: string;
  private sections: Section[] = [];
  private options: SafeWriteOptions;

  constructor(targetPath: string, options: SafeWriteOptions = {}) {
    this.targetPath = targetPath;
    this.checkpointPath = targetPath + '.checkpoint.json';
    this.backupPath = targetPath + '.backup';
    this.options = {
      enableEmojis: false,
      checkpointInterval: 1,
      autoBackup: true,
      verifyWrite: true,
      maxRetries: 3,
      ...options
    };
  }

  // 이모지 제거 함수
  private removeEmojis(text: string): string {
    if (this.options.enableEmojis) return text;
    
    // 이모지 패턴 정규식
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    
    return text.replace(emojiRegex, '');
  }

  // 로그 출력 (이모지 제거 적용)
  private log(message: string): void {
    console.log(this.removeEmojis(message));
  }

  // 섹션 추가
  addSection(id: string, name: string, content: string): void {
    const cleanContent = this.removeEmojis(content);
    const lineCount = cleanContent.split('\n').length;
    const size = Buffer.byteLength(cleanContent, 'utf8');
    
    this.sections.push({
      id,
      name,
      content: cleanContent,
      lineCount,
      size
    });
    
    this.log(`섹션 추가: ${name} (${lineCount}줄, ${(size/1024).toFixed(1)}KB)`);
  }

  // 체크포인트 저장
  private async saveCheckpoint(
    completedSections: string[], 
    currentSection: number, 
    fileSize: number, 
    lineCount: number,
    mode: 'write' | 'append'
  ): Promise<void> {
    const checkpoint: CheckpointData = {
      targetFile: this.targetPath,
      totalSections: this.sections.length,
      completedSections,
      currentSection,
      timestamp: new Date().toISOString(),
      fileSize,
      lastLineCount: lineCount,
      mode
    };

    await fs.writeFile(this.checkpointPath, JSON.stringify(checkpoint, null, 2));
    this.log(`체크포인트 저장: 섹션 ${currentSection}/${this.sections.length} 완료`);
  }

  // 체크포인트 로드
  private async loadCheckpoint(): Promise<CheckpointData | null> {
    try {
      const data = await fs.readFile(this.checkpointPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  // 백업 생성
  private async createBackup(): Promise<void> {
    if (!this.options.autoBackup) return;
    
    try {
      await fs.copyFile(this.targetPath, this.backupPath);
      this.log(`백업 생성: ${this.backupPath}`);
    } catch (error) {
      this.log('새 파일 생성 (백업 없음)');
    }
  }

  // 백업에서 복구
  private async restoreFromBackup(): Promise<boolean> {
    try {
      await fs.copyFile(this.backupPath, this.targetPath);
      this.log(`백업에서 복구: ${this.targetPath}`);
      return true;
    } catch (error) {
      this.log('백업 파일 없음');
      return false;
    }
  }

  // 파일 상태 검증
  private async verifyFileState(): Promise<{ size: number; lineCount: number } | null> {
    try {
      const content = await fs.readFile(this.targetPath, 'utf8');
      const lineCount = content.split('\n').length;
      const size = Buffer.byteLength(content, 'utf8');
      return { size, lineCount };
    } catch (error) {
      return null;
    }
  }

  // 진행률 표시
  private showProgress(current: number, total: number, sectionName: string): void {
    const percentage = ((current / total) * 100).toFixed(1);
    const filled = Math.floor(current / total * 20);
    const progressBar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    this.log(`진행률: [${progressBar}] ${percentage}% (${current}/${total}) - ${sectionName}`);
  }

  // 안전한 파일 작성
  async writeSafely(mode: 'write' | 'append' = 'write'): Promise<boolean> {
    this.log('대용량 파일 안전 작성 시작...');
    
    // 백업 생성
    await this.createBackup();

    // 기존 체크포인트 확인
    const existingCheckpoint = await this.loadCheckpoint();
    let startSection = 0;
    let completedSections: string[] = [];

    if (existingCheckpoint) {
      this.log('기존 체크포인트 발견!');
      this.log(`마지막 저장: ${existingCheckpoint.timestamp}`);
      this.log(`완료된 섹션: ${existingCheckpoint.completedSections.length}/${existingCheckpoint.totalSections}`);
      
      // 파일 상태 검증
      const currentState = await this.verifyFileState();
      if (currentState && currentState.size === existingCheckpoint.fileSize) {
        startSection = existingCheckpoint.currentSection;
        completedSections = existingCheckpoint.completedSections;
        mode = existingCheckpoint.mode;
        this.log('파일 상태 일치. 이어서 작성합니다.');
      } else {
        this.log('파일 상태 불일치. 처음부터 다시 작성합니다.');
        startSection = 0;
        completedSections = [];
      }
    }

    try {
      let currentFileSize = 0;
      let currentLineCount = 0;

      // 첫 번째 섹션 또는 새로 시작하는 경우
      if (startSection === 0) {
        const firstSection = this.sections[0];
        if (mode === 'write') {
          await fs.writeFile(this.targetPath, firstSection.content);
        } else {
          await fs.appendFile(this.targetPath, firstSection.content);
        }
        
        completedSections.push(firstSection.id);
        currentFileSize = firstSection.size;
        currentLineCount = firstSection.lineCount;
        
        await this.saveCheckpoint(completedSections, 1, currentFileSize, currentLineCount, mode);
        this.showProgress(1, this.sections.length, firstSection.name);
        startSection = 1;
      } else {
        // 기존 파일 상태 가져오기
        const state = await this.verifyFileState();
        if (state) {
          currentFileSize = state.size;
          currentLineCount = state.lineCount;
        }
      }

      // 나머지 섹션들 append
      for (let i = startSection; i < this.sections.length; i++) {
        const section = this.sections[i];
        
        // 이미 완료된 섹션인지 확인
        if (completedSections.includes(section.id)) {
          this.log(`섹션 건너뛰기: ${section.name} (이미 완료됨)`);
          continue;
        }

        try {
          // 섹션 내용 append
          await fs.appendFile(this.targetPath, section.content);
          
          completedSections.push(section.id);
          currentFileSize += section.size;
          currentLineCount += section.lineCount;

          // 체크포인트 저장 (설정된 간격마다)
          if (i % (this.options.checkpointInterval || 1) === 0) {
            await this.saveCheckpoint(completedSections, i + 1, currentFileSize, currentLineCount, mode);
          }
          
          this.showProgress(i + 1, this.sections.length, section.name);

          // 잠시 대기 (너무 빠른 작성 방지)
          await new Promise(resolve => setTimeout(resolve, 10));

        } catch (error) {
          this.log(`섹션 작성 실패: ${section.name}`);
          throw error;
        }
      }

      // 작성 완료
      this.log('모든 섹션 작성 완료!');
      
      // 최종 검증
      if (this.options.verifyWrite) {
        const finalState = await this.verifyFileState();
        if (finalState) {
          this.log(`최종 파일 크기: ${(finalState.size/1024).toFixed(1)}KB`);
          this.log(`최종 라인 수: ${finalState.lineCount.toLocaleString()}줄`);
        }
      }

      // 체크포인트 파일 삭제
      await fs.unlink(this.checkpointPath).catch(() => {});
      this.log('체크포인트 파일 정리 완료');

      return true;

    } catch (error) {
      this.log('작성 중 오류 발생: ' + (error instanceof Error ? error.message : String(error)));
      
      // 백업에서 복구 시도
      const restored = await this.restoreFromBackup();
      if (restored) {
        this.log('백업에서 복구 완료');
      }
      
      return false;
    }
  }

  // 상태 확인
  async getStatus(): Promise<void> {
    const checkpoint = await this.loadCheckpoint();
    const fileState = await this.verifyFileState();

    this.log('\n=== 파일 작성 상태 ===');
    
    if (checkpoint) {
      this.log(`체크포인트: ${checkpoint.timestamp}`);
      this.log(`완료된 섹션: ${checkpoint.completedSections.length}/${checkpoint.totalSections}`);
      this.log(`진행률: ${(checkpoint.completedSections.length / checkpoint.totalSections * 100).toFixed(1)}%`);
    } else {
      this.log('체크포인트 없음 (새로 시작)');
    }

    if (fileState) {
      this.log(`현재 파일: ${(fileState.size/1024).toFixed(1)}KB, ${fileState.lineCount.toLocaleString()}줄`);
    } else {
      this.log('파일 없음');
    }

    this.log(`목표 섹션: ${this.sections.length}개`);
    this.log('========================\n');
  }

  // 체크포인트 초기화
  async resetCheckpoint(): Promise<void> {
    try {
      await fs.unlink(this.checkpointPath);
      this.log('체크포인트 초기화 완료');
    } catch (error) {
      this.log('체크포인트 파일 없음');
    }
  }

  // 남은 섹션들만 추가로 작성
  async continueFromCheckpoint(): Promise<boolean> {
    this.log('체크포인트에서 이어서 작성 시작...');
    return await this.writeSafely('append');
  }

  // 섹션 목록 조회
  getSections(): Section[] {
    return this.sections;
  }

  // 총 크기 계산
  getTotalSize(): number {
    return this.sections.reduce((total, section) => total + section.size, 0);
  }

  // 총 라인 수 계산
  getTotalLines(): number {
    return this.sections.reduce((total, section) => total + section.lineCount, 0);
  }
}

export default SafeLargeFileWriter;