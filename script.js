/**
 * 옴의 법칙 과학 시뮬레이션 프로그램 - script.js
 * 고등학교 과학 수업을 위한 반응형 터치 회로 시뮬레이터
 */

// ==========================================
// 0-PRE. 테마 초기 적용 (로딩 시 깜빡임 방지)
// ==========================================
(function() {
  const saved = localStorage.getItem('ohm-theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
})();

// ==========================================
// 0. 상수 & 전역 상태 (State)
// ==========================================
const GRID_SIZE = 20;

// 색띠 표준 색상 정의
const COLOR_BAND_MAP = [
  { color: '#000000', name: '검정', value: 0, multiplier: 1 },
  { color: '#a0522d', name: '갈색', value: 1, multiplier: 10 },
  { color: '#ff0000', name: '빨강', value: 2, multiplier: 100 },
  { color: '#ff9100', name: '주황', value: 3, multiplier: 1000 },
  { color: '#ffeb3b', name: '노랑', value: 4, multiplier: 10000 },
  { color: '#4caf50', name: '초록', value: 5, multiplier: 100000 },
  { color: '#2196f3', name: '파랑', value: 6, multiplier: 1000000 },
  { color: '#9c27b0', name: '보라', value: 7, multiplier: 10000000 },
  { color: '#9e9e9e', name: '회색', value: 8, multiplier: 100000000 },
  { color: '#ffffff', name: '흰색', value: 9, multiplier: 1000000000 }
];

const GOLD_BAND = { color: '#cfb53b', name: '금색', tolerance: '±5%' };

// 시뮬레이터 전역 상태
const state = {
  components: [],      // 배치된 소자 리스트
  wires: [],           // 도선 연결 리스트
  selectedComponent: null, // 현재 선택된 소자
  selectedWire: null,  // 현재 선택된 도선
  
  // 캔버스 변환 상태 (Zoom & Pan)
  transform: {
    x: 0,
    y: 0,
    scale: 1.8
  },
  
  // 마우스/터치 인터랙션 상태
  interaction: {
    mode: 'none',        // 'none', 'pan', 'drag-comp', 'draw-wire'
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    draggedComponent: null,
    activeTerminal: null, // 도선 연결을 그릴 때 기준이 되는 단자
    tempWireEnd: { x: 0, y: 0 },
    pinchStartDist: 0,   // 모바일 핀치 줌용
    pinchStartScale: 1.0
  },
  
  // 설정 토글 상태
  options: {
    showElectrons: true,
    flowDirection: 'electrons', // 'electrons' (- → +) or 'current' (+ → -)
    showValues: true,
    showSymbols: true
  },
  
  // 흐름 애니메이션을 위한 오프셋
  animationTime: 0
};

// ==========================================
// 2. 클래스 정의 (소자 및 단자)
// ==========================================

class Terminal {
  /**
   * @param {string} id 단자 고유 ID
   * @param {Component} component 소속 소자
   * @param {number} relX 소자 기준 상대 X 좌표
   * @param {number} relY 소자 기준 상대 Y 좌표
   * @param {string} type 단자 타입 ('positive', 'negative', 'neutral')
   */
  constructor(id, component, relX, relY, type = 'neutral') {
    this.id = id;
    this.component = component;
    this.relX = relX;
    this.relY = relY;
    this.type = type; // 'positive' (+극/빨강), 'negative' (-극/파랑), 'neutral' (저항 등 무극성)
    this.nodeIndex = -1; // MNA 계산용 노드 인덱스
  }

  // 캔버스 상의 절대 좌표 구하기 (소자 회전 반영)
  getAbsoluteCoords() {
    const cx = this.component.x + this.component.width / 2;
    const cy = this.component.y + this.component.height / 2;
    
    // 소자 중심 기준 단자의 로컬 상대좌표
    const rx = this.relX - this.component.width / 2;
    const ry = this.relY - this.component.height / 2;
    
    // rotation 각도를 라디안으로 환산
    const rad = (this.component.rotation * Math.PI) / 180;
    
    // 2D 회전 변환 공식 적용
    const rotatedX = rx * Math.cos(rad) - ry * Math.sin(rad);
    const rotatedY = rx * Math.sin(rad) + ry * Math.cos(rad);
    
    return {
      x: cx + rotatedX,
      y: cy + rotatedY
    };
  }
}

class Component {
  /**
   * @param {string} type 'battery', 'resistor', 'bulb', 'switch', 'junction'
   * @param {number} x 그리드 격자 x
   * @param {number} y 그리드 격자 y
   */
  constructor(type, x, y) {
    this.id = type + '_' + Math.random().toString(36).substr(2, 9);
    this.type = type;
    this.x = Math.round(x / GRID_SIZE) * GRID_SIZE;
    this.y = Math.round(y / GRID_SIZE) * GRID_SIZE;
    this.width = 120; // 기본 크기
    this.height = 60;
    this.rotation = 0; // 회전 상태 추가 (0, 90, 180, 270)
    this.selected = false;

    // 전류 및 전압 결과값 초기화
    this.voltageDiff = 0;
    this.current = 0;

    // 소자별 초기 파라미터 정의
    if (this.type === 'battery') {
      this.value = 9.0; // 9V 초기 전압
      this.terminals = [
        new Terminal(this.id + '_tA', this, 0, 30, 'positive'), // 왼쪽 양극 (+빨강)
        new Terminal(this.id + '_tB', this, 120, 30, 'negative') // 오른쪽 음극 (-파랑)
      ];
    } else if (this.type === 'resistor') {
      this.value = 10.0; // 10옴 초기 저항
      this.terminals = [
        new Terminal(this.id + '_tA', this, 0, 30, 'neutral'),
        new Terminal(this.id + '_tB', this, 120, 30, 'neutral')
      ];
    } else if (this.type === 'bulb') {
      this.value = 10.0; // 10옴 초기 전구 내부 저항
      this.terminals = [
        new Terminal(this.id + '_tA', this, 0, 30, 'neutral'),
        new Terminal(this.id + '_tB', this, 120, 30, 'neutral')
      ];
    } else if (this.type === 'switch') {
      this.isOpen = true; // 스위치는 처음에 열린(OFF) 상태
      this.terminals = [
        new Terminal(this.id + '_tA', this, 0, 30, 'neutral'),
        new Terminal(this.id + '_tB', this, 120, 30, 'neutral')
      ];
    } else if (this.type === 'junction') {
      this.width = 40;
      this.height = 40;
      this.terminals = [
        new Terminal(this.id + '_tC', this, 20, 20, 'neutral')
      ];
    } else if (this.type === 'ammeter') {
      this.value = 1e-6; // 아주 작은 저항
      this.terminals = [
        new Terminal(this.id + '_tA', this, 0, 30, 'positive'),
        new Terminal(this.id + '_tB', this, 120, 30, 'negative')
      ];
    } else if (this.type === 'voltmeter') {
      this.value = 1e7; // 아주 큰 저항 (실제 디지털 전압계 표준인 10MΩ)
      this.terminals = [
        new Terminal(this.id + '_tA', this, 0, 30, 'positive'),
        new Terminal(this.id + '_tB', this, 120, 30, 'negative')
      ];
    }
  }

  // 소자의 2D 박스 영역 구하기
  getBoundingBox() {
    const cx = this.x + this.width / 2;
    const cy = this.y + this.height / 2;
    const isRotated = (this.rotation === 90 || this.rotation === 270);
    const w = isRotated ? this.height : this.width;
    const h = isRotated ? this.width : this.height;
    return {
      x: cx - w / 2,
      y: cy - h / 2,
      width: w,
      height: h
    };
  }

  // 특정 좌표가 소자 바디 영역에 속하는지 체크
  containsPoint(px, py) {
    const box = this.getBoundingBox();
    return px >= box.x && px <= box.x + box.width &&
           py >= box.y && py <= box.y + box.height;
  }

  // 렌더링 함수
  draw(ctx, animationTime) {
    const box = this.getBoundingBox();
    const cx = this.x + this.width / 2;
    const cy = this.y + this.height / 2;
    const rad = (this.rotation * Math.PI) / 180;
    
    ctx.save();
    
    // Translate and rotate around the component center
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    
    const lx = -this.width / 2;
    const ly = -this.height / 2;
    
    // 1. 선택된 소자 발광 아웃라인 효과
    if (this.selected) {
      ctx.shadowColor = varColor('--accent-cyan');
      ctx.shadowBlur = 15;
      ctx.strokeStyle = varColor('--accent-cyan');
      ctx.lineWidth = 3;
      if (this.type === 'junction') {
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.stroke();
      } else if (state.options.showSymbols) {
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(lx - 4, ly - 4, this.width + 8, this.height + 8);
        ctx.setLineDash([]);
      } else {
        ctx.strokeRect(lx - 4, ly - 4, this.width + 8, this.height + 8);
      }
      ctx.shadowBlur = 0; // 초기화
    }

    // 2. 소자 바디 백그라운드 그리기
    if (this.type === 'junction') {
      // Junction does not have a general card body
    } else if (state.options.showSymbols) {
      // 기호 모드: 클릭 및 드래그 범위를 보여주는 아주 미세한 점선 테두리만 렌더링
      ctx.strokeStyle = this.selected ? 'rgba(0, 229, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.roundRect(lx, ly, this.width, this.height, 8);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // 실사 모드: 풀 바디 카드 렌더링
      ctx.fillStyle = varColor('--bg-card-light');
      ctx.strokeStyle = this.selected ? varColor('--accent-cyan') : varColor('--border-color');
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(lx, ly, this.width, this.height, 12);
      ctx.fill();
      ctx.stroke();
    }

    // 3. 연결 전선 핀 그리기 (도선 연결 단자)
    if (this.type !== 'junction') {
      this.terminals.forEach(t => {
        const rx = t.relX - this.width / 2;
        const ry = t.relY - this.height / 2;
        ctx.beginPath();
        
        // 기호 모드에서는 단자를 더 작고 깔끔한 스케매틱 접점(5px)으로 그림
        const r = state.options.showSymbols ? 5 : 8;
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        
        if (t.type === 'positive') {
          ctx.fillStyle = '#ff4081'; // +극: 진분홍색
        } else if (t.type === 'negative') {
          ctx.fillStyle = '#00e5ff'; // -극: 하늘색
        } else {
          ctx.fillStyle = state.options.showSymbols ? '#78909c' : '#b0bec5'; // 무극성
        }
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = state.options.showSymbols ? 1.0 : 1.5;
        ctx.stroke();
      });
    }

    // 4. 소자 상세 기호 / 실제 그림 그리기
    
    // 1) 배터리 그리기
    if (this.type === 'battery') {
      if (state.options.showSymbols) {
        const rx = 0;
        const ry = 0;
        
        // 연결선
        ctx.strokeStyle = '#8c9bb4';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(lx, ry);
        ctx.lineTo(rx - 5, ry);
        ctx.moveTo(rx + 5, ry);
        ctx.lineTo(lx + this.width, ry);
        ctx.stroke();
        
        // 전압원 극판 기호 그리기 (긴 선은 +, 짧고 굵은 선은 -)
        // 양극(+) 판: 좌측, 길고 얇음
        ctx.strokeStyle = '#ff4081';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(rx - 5, ry - 20);
        ctx.lineTo(rx - 5, ry + 20);
        ctx.stroke();
        
        // 음극(-) 판: 우측, 짧고 굵음
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(rx + 5, ry - 10);
        ctx.lineTo(rx + 5, ry + 10);
        ctx.stroke();
        
        // 극성 라벨 텍스트 (+ / -)
        ctx.fillStyle = '#ff4081';
        ctx.font = 'bold 14px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', rx - 18, ry - 12);
        
        ctx.fillStyle = '#00e5ff';
        ctx.fillText('-', rx + 18, ry - 12);
        
        // 실시간 전압 수치
        if (state.options.showValues) {
          ctx.fillStyle = varColor('--text-on-card');
          ctx.font = 'bold 28px Outfit, sans-serif';
          ctx.fillText(`${this.value.toFixed(1)}V`, rx, ry + 35);
        }
      } else {
        // 배터리 외형 네온 스타일 데코 (실사 모드)
        ctx.fillStyle = 'rgba(255, 64, 129, 0.1)';
        ctx.fillRect(lx + 10, ly + 10, 50, this.height - 20);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.1)';
        ctx.fillRect(lx + 60, ly + 10, 50, this.height - 20);

        // 텍스트 기호 표시
        ctx.fillStyle = '#ff4081';
        ctx.font = 'bold 20px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', lx + 35, ly + 30);

        ctx.fillStyle = '#00e5ff';
        ctx.fillText('-', lx + 85, ly + 30);

        // 전압 수치 텍스트
        ctx.fillStyle = varColor('--text-on-card');
        ctx.font = 'bold 32px Outfit, sans-serif';
        ctx.fillText(`${this.value.toFixed(1)}V`, lx + 60, ly + 40);
      }
    }
    
    // 2) 저항기 그리기
    else if (this.type === 'resistor') {
      if (state.options.showSymbols) {
        const rx = 0;
        const ry = 0;
        
        // 저항 기호 지그재그 그리기
        ctx.strokeStyle = '#ff9100'; // 저항 주황색 매칭
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        
        ctx.moveTo(lx, ry);
        ctx.lineTo(lx + 30, ry);
        
        // 지그재그 꺾임 포인트들
        ctx.lineTo(lx + 35, ry - 12);
        ctx.lineTo(lx + 45, ry + 12);
        ctx.lineTo(lx + 55, ry - 12);
        ctx.lineTo(lx + 65, ry + 12);
        ctx.lineTo(lx + 75, ry - 12);
        ctx.lineTo(lx + 85, ry + 12);
        ctx.lineTo(lx + 90, ry);
        
        ctx.lineTo(lx + this.width, ry);
        ctx.stroke();
        
        // 저항 수치 표시 (저항은 위쪽, 전압/전류는 아래쪽 서로 다른 줄에 표시)
        if (state.options.showValues) {
          ctx.font = 'bold 24px Outfit';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // 위쪽: 저항값 (Ω)
          ctx.fillStyle = varColor('--text-on-card');
          ctx.fillText(`${this.value.toFixed(0)}Ω`, rx, ry - 35);
          
          // 아래쪽 1번 줄: 전압값 (V)
          ctx.fillStyle = varColor('--accent-cyan');
          ctx.fillText(`${this.voltageDiff.toFixed(2)}V`, rx, ry + 25);
          
          // 아래쪽 2번 줄: 전류값 (A)
          ctx.fillStyle = varColor('--accent-yellow');
          ctx.fillText(`${Math.abs(this.current).toFixed(2)}A`, rx, ry + 50);
        }
      } else {
        // 저항 바디 그리기 (갈색 모래시계 비슷한 둥근 형태)
        const resX = lx + 25;
        const resY = ly + 18;
        const resW = 70;
        const resH = 24;
        
        ctx.fillStyle = '#e5c298'; // 저항 기본 베이지색
        ctx.beginPath();
        ctx.roundRect(resX, resY, resW, resH, 8);
        ctx.fill();
        ctx.strokeStyle = '#5d4037';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 양 끝 도선 핀 연결 도선 느낌 그리기
        ctx.strokeStyle = '#8c9bb4';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx, ly + 30);
        ctx.lineTo(resX, ly + 30);
        ctx.moveTo(resX + resW, ly + 30);
        ctx.lineTo(lx + this.width, ly + 30);
        ctx.stroke();

        // 저항 색띠 렌더링 (저항값에 기반한 실시간 색띠!)
        const bands = getResistorColorBands(this.value);
        const bandSpacing = resW / 5;
        bands.forEach((b, idx) => {
          ctx.fillStyle = b.color;
          ctx.fillRect(resX + 12 + idx * bandSpacing, resY, 5, resH);
        });

        // 저항 수치 표시 (저항은 위쪽, 전압/전류는 아래쪽 서로 다른 줄에 표시)
        if (state.options.showValues) {
          ctx.font = 'bold 24px Outfit';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // 위쪽: 저항값 (Ω)
          ctx.fillStyle = varColor('--text-on-card');
          ctx.fillText(`${this.value.toFixed(0)}Ω`, lx + 60, ly - 5);
          
          // 아래쪽 1번 줄: 전압값 (V)
          ctx.fillStyle = varColor('--accent-cyan');
          ctx.fillText(`${this.voltageDiff.toFixed(2)}V`, lx + 60, ly + 60);
          
          // 아래쪽 2번 줄: 전류값 (A)
          ctx.fillStyle = varColor('--accent-yellow');
          ctx.fillText(`${Math.abs(this.current).toFixed(2)}A`, lx + 60, ly + 85);
        }
      }
    }
    
    // 3) 전구 그리기
    else if (this.type === 'bulb') {
      const rx = 0;
      const ry = 0;
      const r = 16;
      
      const isGlowing = Math.abs(this.current) > 0.001;
      const brightness = Math.min(Math.abs(this.current) * 2, 1.5); // 전류에 따라 밝기 스케일

      if (state.options.showSymbols) {
        // 전구 기호: 동그라미 안에 X 표시
        // 양 끝 도선
        ctx.strokeStyle = isGlowing ? '#ffeb3b' : '#8c9bb4';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(lx, ry);
        ctx.lineTo(rx - r, ry);
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(lx + this.width, ry);
        ctx.stroke();

        // 전구 활성화 시 발광(아우라) 효과
        if (isGlowing) {
          ctx.save();
          ctx.shadowColor = '#ffeb3b';
          ctx.shadowBlur = 10 + brightness * 25;
          
          const grad = ctx.createRadialGradient(rx, ry, 2, rx, ry, r + brightness * 20);
          grad.addColorStop(0, 'rgba(255, 235, 59, 0.5)');
          grad.addColorStop(0.5, 'rgba(255, 235, 59, 0.2)');
          grad.addColorStop(1, 'rgba(255, 235, 59, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(rx, ry, r + brightness * 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // 동그라미 기호 몸체
        ctx.fillStyle = isGlowing ? 'rgba(255, 235, 59, 0.1)' : 'rgba(255, 255, 255, 0.02)';
        ctx.strokeStyle = isGlowing ? '#ffeb3b' : '#8c9bb4';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 내부 X 표시 그리기
        const offset = r / Math.sqrt(2); // 내접 정사각형 좌표 offset 계산
        ctx.beginPath();
        ctx.moveTo(rx - offset, ry - offset);
        ctx.lineTo(rx + offset, ry + offset);
        ctx.moveTo(rx - offset, ry + offset);
        ctx.lineTo(rx + offset, ry - offset);
        ctx.stroke();

        // 전구 수치 및 전력 세기 표시 (저항은 위쪽, 전압/전류는 아래쪽 서로 다른 줄에 표시)
        if (state.options.showValues) {
          ctx.font = 'bold 24px Outfit';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // 위쪽: 저항값 (Ω)
          ctx.fillStyle = isGlowing ? varColor('--accent-yellow') : varColor('--text-on-card');
          ctx.fillText(`${this.value.toFixed(0)}Ω`, rx, ry - 35);
          
          // 아래쪽 1번 줄: 전압값 (V)
          ctx.fillStyle = varColor('--accent-cyan');
          ctx.fillText(`${this.voltageDiff.toFixed(2)}V`, rx, ry + 25);
          
          // 아래쪽 2번 줄: 전류값 (A)
          ctx.fillStyle = isGlowing ? varColor('--accent-yellow') : varColor('--text-on-card');
          ctx.fillText(`${Math.abs(this.current).toFixed(2)}A`, rx, ry + 50);
        }
      } else {
        // 실사 모드 전구 그리기 (기존)
        const bulbCy = ly + 25;
        
        // 양 끝 도선 그리기
        ctx.strokeStyle = '#8c9bb4';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx, ly + 30);
        ctx.lineTo(rx - 15, ly + 30);
        ctx.moveTo(rx + 15, ly + 30);
        ctx.lineTo(lx + this.width, ly + 30);
        ctx.stroke();

        if (isGlowing) {
          ctx.save();
          ctx.shadowColor = '#ffeb3b';
          ctx.shadowBlur = 10 + brightness * 25;
          
          const grad = ctx.createRadialGradient(rx, bulbCy, 2, rx, bulbCy, 18 + brightness * 20);
          grad.addColorStop(0, 'rgba(255, 235, 59, 0.9)');
          grad.addColorStop(0.3, 'rgba(255, 235, 59, 0.4)');
          grad.addColorStop(1, 'rgba(255, 235, 59, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(rx, bulbCy, 18 + brightness * 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // 전구 유리구 형태
        ctx.fillStyle = isGlowing ? 'rgba(255, 235, 59, 0.3)' : 'rgba(255, 255, 255, 0.05)';
        ctx.strokeStyle = isGlowing ? '#ffeb3b' : '#8c9bb4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rx, bulbCy, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 내부 필라멘트 그리기
        ctx.strokeStyle = isGlowing ? '#ffeb3b' : '#8c9bb4';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rx - 6, bulbCy + 6);
        ctx.lineTo(rx - 3, bulbCy - 2);
        ctx.lineTo(rx + 3, bulbCy - 2);
        ctx.lineTo(rx + 6, bulbCy + 6);
        ctx.stroke();

        // 전구 수치 및 전력 세기 표시 (저항은 위쪽, 전압/전류는 아래쪽 서로 다른 줄에 표시)
        if (state.options.showValues) {
          ctx.font = 'bold 24px Outfit';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // 위쪽: 저항값 (Ω)
          ctx.fillStyle = isGlowing ? varColor('--accent-yellow') : varColor('--text-on-card');
          ctx.fillText(`${this.value.toFixed(0)}Ω`, lx + 60, ly - 5);
          
          // 아래쪽 1번 줄: 전압값 (V)
          ctx.fillStyle = varColor('--accent-cyan');
          ctx.fillText(`${this.voltageDiff.toFixed(2)}V`, lx + 60, ly + 60);
          
          // 아래쪽 2번 줄: 전류값 (A)
          ctx.fillStyle = isGlowing ? varColor('--accent-yellow') : varColor('--text-on-card');
          ctx.fillText(`${Math.abs(this.current).toFixed(2)}A`, lx + 60, ly + 85);
        }
      }
    }
    
    // 4) 스위치 그리기
    else if (this.type === 'switch') {
      const rx = 0;
      const ry = 0;

      if (state.options.showSymbols) {
        // 스위치 기호 그리기 (두 접점 도트와 회전 가동 레버)
        // 양 끝 연결선
        ctx.strokeStyle = '#ff4081';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(lx, ry);
        ctx.lineTo(lx + 35, ry);
        ctx.moveTo(lx + 85, ry);
        ctx.lineTo(lx + this.width, ry);
        ctx.stroke();

        // 양단 접점 단자 그리기
        ctx.fillStyle = '#ff4081';
        ctx.beginPath();
        ctx.arc(lx + 35, ry, 4, 0, Math.PI * 2);
        ctx.arc(lx + 85, ry, 4, 0, Math.PI * 2);
        ctx.fill();

        // 가동 스위치 블레이드(레버)
        ctx.strokeStyle = '#ff4081';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (this.isOpen) {
          // 스위치 열림 (30도 경사 위로)
          ctx.moveTo(lx + 35, ry);
          ctx.lineTo(lx + 75, ry - 18);
        } else {
          // 스위치 닫힘 (수평 직결)
          ctx.moveTo(lx + 35, ry);
          ctx.lineTo(lx + 85, ry);
        }
        ctx.stroke();

        // 텍스트 상태 정보
        ctx.fillStyle = this.isOpen ? varColor('--text-muted') : varColor('--accent-cyan');
        ctx.font = 'bold 13px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.isOpen ? '열림 (OFF)' : '닫힘 (ON)', rx, ry + 24);
      } else {
        // 실사 모드 스위치 그리기
        // 양 끝 도선 핀 그리기
        ctx.strokeStyle = '#8c9bb4';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx, ly + 30);
        ctx.lineTo(lx + 35, ly + 30);
        ctx.moveTo(lx + 85, ly + 30);
        ctx.lineTo(lx + this.width, ly + 30);
        ctx.stroke();

        // 스위치 단자 도트
        ctx.fillStyle = '#ff4081';
        ctx.beginPath();
        ctx.arc(lx + 35, ly + 30, 4, 0, Math.PI * 2);
        ctx.arc(lx + 85, ly + 30, 4, 0, Math.PI * 2);
        ctx.fill();

        // 스위치 커넥터 레버
        ctx.strokeStyle = '#ff4081';
        ctx.lineWidth = 4.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (this.isOpen) {
          // 열린 스위치 (대각선으로 레버가 들림)
          ctx.moveTo(lx + 35, ly + 30);
          ctx.lineTo(lx + 75, ly + 10);
        } else {
          // 닫힌 스위치 (연결 상태)
          ctx.moveTo(lx + 35, ly + 30);
          ctx.lineTo(lx + 85, ly + 30);
        }
        ctx.stroke();

        // 텍스트 상태 정보
        ctx.fillStyle = this.isOpen ? varColor('--text-muted') : varColor('--accent-cyan');
        ctx.font = 'bold 13px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.isOpen ? '열림 (OFF)' : '닫힘 (ON)', lx + 60, ly + 52);
      }
    }
    
    // 4.5) 전류계 및 전압계 그리기
    else if (this.type === 'ammeter' || this.type === 'voltmeter') {
      const isAmmeter = this.type === 'ammeter';
      const label = isAmmeter ? 'A' : 'V';
      const color = isAmmeter ? '#ff4081' : '#00e5ff';
      const bg = isAmmeter ? 'rgba(255, 64, 129, 0.1)' : 'rgba(0, 229, 255, 0.1)';
      
      const rx = 0;
      const ry = 0;
      
      ctx.strokeStyle = '#8c9bb4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (state.options.showSymbols) {
        ctx.moveTo(lx, ry);
        ctx.lineTo(rx - 16, ry);
        ctx.moveTo(rx + 16, ry);
        ctx.lineTo(lx + this.width, ry);
      } else {
        ctx.moveTo(lx, ly + 30);
        ctx.lineTo(rx - 16, ly + 30);
        ctx.moveTo(rx + 16, ly + 30);
        ctx.lineTo(lx + this.width, ly + 30);
      }
      ctx.stroke();

      const centerY = state.options.showSymbols ? ry : ly + 30;

      ctx.fillStyle = bg;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rx, centerY, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = 'bold 20px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rx, centerY);

      if (state.options.showValues) {
        ctx.fillStyle = color;
        ctx.font = 'bold 24px Outfit';
        const valText = isAmmeter ? `${Math.abs(this.current).toFixed(2)}A` : `${this.voltageDiff.toFixed(2)}V`;
        ctx.fillText(valText, rx, centerY + 35);
      }
    }
    
    // 5) 연결 접점 (정션) 그리기
    else if (this.type === 'junction') {
      const rx = 0;
      const ry = 0;
      ctx.beginPath();
      ctx.arc(rx, ry, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#78909c';
      ctx.fill();
      ctx.strokeStyle = varColor('--junction-stroke');
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(rx, ry, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = varColor('--accent-cyan');
      ctx.fill();
    }

    ctx.restore();

    // 소자에 흐르는 실시간 전류 수치 말풍선 (선택 시 상시 오버레이, 회전과 무관하게 상시 수평 유지)
    if (this.selected && this.type !== 'battery' && this.type !== 'switch' && this.type !== 'junction') {
      const text = `${this.voltageDiff.toFixed(2)}V, ${this.current.toFixed(2)}A`;
      ctx.save();
      ctx.fillStyle = varColor('--bg-tooltip');
      ctx.strokeStyle = varColor('--accent-cyan');
      ctx.lineWidth = 1;
      
      const textWidth = ctx.measureText(text).width + 20;
      const bubbleX = box.x + (box.width - textWidth) / 2;
      const bubbleY = box.y - 35;
      
      ctx.beginPath();
      ctx.roundRect(bubbleX, bubbleY, textWidth, 24, 6);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = varColor('--text-tooltip');
      ctx.font = 'bold 12px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, box.x + box.width / 2, bubbleY + 12);
      ctx.restore();
    }
  }
}

// ==========================================
// 3. 저항 색띠 도출 유틸리티 함수
// ==========================================
function getResistorColorBands(ohms) {
  if (ohms < 1) ohms = 1;
  const ohmsStr = Math.round(ohms).toString();
  let firstDigit = 0;
  let secondDigit = 0;
  let multiplierExponent = 0;

  if (ohmsStr.length === 1) {
    firstDigit = parseInt(ohmsStr[0]);
    secondDigit = 0;
    multiplierExponent = -1; // 4색띠 기준 0.1 배수는 보통 금색이지만, 시각적 표현 편의상 10^0 = 1로 연동
    multiplierExponent = 0; // 1~9는 10^0 승으로 통일 (두번째 숫자는 0으로 처리)
    // 예: 5옴 -> 5, 0 * 10^-1 = 5옴 이나 4색띠는 갈색(10)에서 표현.
    // 본 교육용 시뮬레이션에서는 1옴 ~ 1000옴 범위이므로:
    // ohms = A B * 10^C 공식 적용.
  }
  
  // A B * 10^C 형태 구하기
  if (ohms >= 10) {
    firstDigit = parseInt(ohmsStr[0]);
    secondDigit = parseInt(ohmsStr[1]);
    multiplierExponent = ohmsStr.length - 2;
  } else {
    // 10미만 저항 (예: 5옴) -> 5 0 x 10^-1 = 5.0옴
    firstDigit = Math.floor(ohms);
    secondDigit = 0;
    multiplierExponent = -1; // 배수 0.1
  }

  const band1 = COLOR_BAND_MAP[firstDigit] || COLOR_BAND_MAP[0];
  const band2 = COLOR_BAND_MAP[secondDigit] || COLOR_BAND_MAP[0];
  
  let multiplierIndex = multiplierExponent;
  // 배수가 0.1인 경우의 인덱스 예외 처리 (여기서는 0이상의 인덱스로 매핑하기 위해 보정)
  if (multiplierIndex < 0) multiplierIndex = 0; // 10^0 배수로 처리
  
  const band3 = COLOR_BAND_MAP[multiplierIndex] || COLOR_BAND_MAP[0];
  const band4 = GOLD_BAND; // 오차 5% 고정

  return [band1, band2, band3, band4];
}

// CSS 변수를 JS에서 직접 추출하여 캔버스 색상 유지
// document.body에서 읽어야 body.light-mode 클래스 변화가 즉시 반영됨
function varColor(cssVarName) {
  const val = getComputedStyle(document.body).getPropertyValue(cssVarName).trim();
  if (val) return val;
  // 폴백 설정 (다크 모드 기본값)
  const darkFallbacks = {
    '--accent-cyan': '#00e5ff',
    '--accent-yellow': '#ffeb3b',
    '--accent-pink': '#ff4081',
    '--bg-card-light': '#20284d',
    '--border-color': 'rgba(255, 255, 255, 0.08)',
    '--text-muted': '#8c9bb4',
    '--text-on-card': '#ffffff',
    '--electron-color': '#ffffff',
    '--junction-stroke': '#ffffff',
    '--bg-tooltip': 'rgba(12, 16, 32, 0.95)',
    '--text-tooltip': '#ffffff',
    '--bg-grid-line': 'rgba(255, 255, 255, 0.025)',
  };
  return darkFallbacks[cssVarName] || '#ffffff';
}

// ==========================================
// 4. MNA 회로 해석 알고리즘 (핵심 물리 백엔드)
// ==========================================
function solveCircuit() {
  const comps = state.components;
  const wires = state.wires;

  // 모든 소자의 전류/전압 초기화
  comps.forEach(c => {
    c.current = 0;
    c.voltageDiff = 0;
  });

  if (comps.length === 0) return;

  // 1. 단자들의 그래프 연결성 분석 및 고유 노드 정의
  // 동일한 노드로 묶이는 단자 그룹들을 찾아냅니다. (Union-Find 혹은 BFS)
  const allTerminals = [];
  comps.forEach(c => {
    c.terminals.forEach(t => {
      allTerminals.push(t);
    });
  });

  // 초기화: 각 단자는 자신만의 고유 노드로 시작
  const parent = {};
  allTerminals.forEach(t => parent[t.id] = t.id);

  function find(id) {
    if (parent[id] === id) return id;
    return parent[id] = find(parent[id]);
  }

  function union(id1, id2) {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      parent[root1] = root2;
    }
  }

  // 닫힌 스위치는 단자끼리 직결(도선과 동일)된 것으로 봅니다.
  comps.forEach(c => {
    if (c.type === 'switch' && !c.isOpen) {
      union(c.terminals[0].id, c.terminals[1].id);
    }
  });

  // 도선 연결 적용 (도선 양 끝 단자를 동일한 전기 노드로 연결)
  wires.forEach(w => {
    union(w.from.id, w.to.id);
  });

  // 노드 인덱스 생성
  const nodeGroups = {}; // rootTerminalId -> terminalList
  allTerminals.forEach(t => {
    const root = find(t.id);
    if (!nodeGroups[root]) nodeGroups[root] = [];
    nodeGroups[root].push(t);
  });

  const roots = Object.keys(nodeGroups);
  const numNodes = roots.length; // 전체 전기적 노드 수

  // 각 단자에 노드 번호 부여
  roots.forEach((root, index) => {
    nodeGroups[root].forEach(t => {
      t.nodeIndex = index;
    });
  });

  // 2. MNA 방정식 행렬 구축
  // 배터리(독립 전압원) 수 구하기
  const batteries = comps.filter(c => c.type === 'battery');
  const numVoltSources = batteries.length;

  if (numNodes === 0) return;

  // 행렬 크기: (N-1 + M) x (N-1 + M)
  // N: 노드의 수. 0번 노드를 기준 노드(Ground = 0V)로 사용하므로 실질 변수는 N-1개
  // M: 배터리의 수. 각 배터리를 흐르는 전류를 변수로 추가.
  const matrixDim = numNodes - 1 + numVoltSources;
  if (matrixDim <= 0) return;

  // A * x = B 행렬 초기화
  const A = Array.from({ length: matrixDim }, () => Array(matrixDim).fill(0));
  const B = Array(matrixDim).fill(0);

  // MNA에 전도도(Conductance = 1 / Resistance) 추가 함수
  function addConductance(node1, node2, g) {
    // node1, node2가 0번 노드(Ground)인 경우 제외하고 대입
    if (node1 > 0) A[node1 - 1][node1 - 1] += g;
    if (node2 > 0) A[node2 - 1][node2 - 1] += g;
    if (node1 > 0 && node2 > 0) {
      A[node1 - 1][node2 - 1] -= g;
      A[node2 - 1][node1 - 1] -= g;
    }
  }

  // MNA에 전압원 추가 함수
  function addVoltageSource(nodePos, nodeNeg, vVal, sourceIdx) {
    const colIdx = numNodes - 1 + sourceIdx; // 행렬에서 전압원 전류 변수의 인덱스
    
    if (nodePos > 0) {
      A[nodePos - 1][colIdx] += 1;
      A[colIdx][nodePos - 1] += 1;
    }
    if (nodeNeg > 0) {
      A[nodeNeg - 1][colIdx] -= 1;
      A[colIdx][nodeNeg - 1] -= 1;
    }
    B[colIdx] = vVal;
  }

  // 각 소자들을 훑으며 스탬핑(Stamping) 수행
  // 개방 회로 등에 의한 수치적 에러(Singular Matrix)를 방지하기 위해 
  // 모든 노드에 아주 아주 미세한 전도도(leakage, 1e-12)를 그라운드와의 사이에 설정
  for (let i = 1; i < numNodes; i++) {
    A[i - 1][i - 1] += 1e-12;
  }

  let voltSourceCount = 0;

  comps.forEach(c => {
    if (c.type === 'junction') return; // Skip junction stamping
    const idxA = c.terminals[0].nodeIndex;
    const idxB = c.terminals[1].nodeIndex;

    if (c.type === 'resistor' || c.type === 'bulb' || c.type === 'ammeter' || c.type === 'voltmeter') {
      const g = 1.0 / c.value;
      addConductance(idxA, idxB, g);
    } 
    else if (c.type === 'switch') {
      if (c.isOpen) {
        // 스위치가 열렸을 때: 완전히 단선되었으므로 전도도를 추가하지 않음 (0)
        addConductance(idxA, idxB, 0);
      } else {
        // 닫힌 스위치는 단자 합침을 적용했으므로 추가 스탬핑 불필요
      }
    } 
    else if (c.type === 'battery') {
      // positive 단자(idxA, +극), negative 단자(idxB, -극)
      // 배터리 전압 관계: V_pos - V_neg = V
      addVoltageSource(idxA, idxB, c.value, voltSourceCount);
      voltSourceCount++;
    }
  });

  // 3. 가우스 소거법 (Gaussian Elimination)으로 Ax = B 풀기
  const x = solveLinearSystem(A, B);

  if (!x) {
    // 회로 단선 등으로 행렬을 풀 수 없는 경우 (0V, 0A 유지)
    return;
  }

  // 4. 노드 전압 결과 역대입 및 소자별 전류 계산
  const nodeVoltages = Array(numNodes).fill(0);
  nodeVoltages[0] = 0; // Ground 노드는 항상 0V
  for (let i = 1; i < numNodes; i++) {
    nodeVoltages[i] = x[i - 1];
  }

  // 배터리 전류 추출
  let batteryIdx = 0;
  comps.forEach(c => {
    if (c.type === 'junction') return; // Skip junction calculation
    const vA = nodeVoltages[c.terminals[0].nodeIndex];
    const vB = nodeVoltages[c.terminals[1].nodeIndex];
    c.voltageDiff = Math.abs(vA - vB);

    if (c.type === 'resistor' || c.type === 'bulb' || c.type === 'ammeter' || c.type === 'voltmeter') {
      c.current = (vA - vB) / c.value;
    } 
    else if (c.type === 'switch') {
      if (c.isOpen) {
        c.current = 0;
      } else {
        // 닫힌 스위치의 경우, 주변 도선 전류 등을 합산해야 하지만 
        // 시각 표현용 간이 전류는 인접 소자의 평균치를 취하는 방식으로 자연스럽게 묘사
        c.current = 0; // 뒤에서 도선 전류 흐름 기반으로 역계산
      }
    } 
    else if (c.type === 'battery') {
      // MNA의 전류 변수 x[numNodes - 1 + batteryIdx]
      // 전압원에서 방출되는 전류 값을 역추적
      const currentVar = x[numNodes - 1 + batteryIdx];
      c.current = currentVar; // 배터리를 흐르는 전류
      batteryIdx++;
    }
  });

  // 5. 도선(Wire)의 실시간 흐름 전류 매칭
  //
  // ★ MNA 배터리 전류 부호 규약 ★
  // MNA 행렬에서 배터리 전류 변수(c.current = I_k)는
  // "전지가 전력을 공급(방전)할 때 음수"입니다.
  //
  // 증명: KCL at nodePos: G·V_pos + I_k = 0
  //       10V 배터리, 5Ω 부하: 0.2×10 + I_k = 0  →  I_k = -2A
  //
  // 따라서 각 단자에서 도선으로 "빠져나가는" 전류:
  //   배터리 terminals[0] (+극): -c.current  (방전 시 양수 = 전류가 외부로 나감)
  //   배터리 terminals[1] (-극): +c.current  (방전 시 음수 = 전류가 내부로 들어옴)
  //   수동소자 terminals[0]    : -c.current  (전류가 도선→소자 방향으로 들어옴)
  //   수동소자 terminals[1]    : +c.current  (전류가 소자→도선 방향으로 나감)

  function currentLeavingTerminal(terminal) {
    const c = terminal.component;
    if (c.type === 'switch' || c.type === 'junction') return null;
    const isTermA = (terminal === c.terminals[0]);
    if (c.type === 'battery') {
      // MNA에서 배터리는 방전 시 c.current < 0 이므로 부호 반전
      // terminals[0] (+극): -c.current  →  양수 = 전류가 외부로 나감
      // terminals[1] (-극): +c.current  →  음수 = 전류가 내부로 들어감
      return isTermA ? -c.current : c.current;
    } else {
      // 수동 소자: c.current = (vA-vB)/R, 양수이면 T0→T1 방향으로 내부 흐름
      // terminals[0]: 전류가 들어오므로 도선으로 나가는 양 = -c.current
      // terminals[1]: 전류가 나가므로 도선으로 나가는 양 = +c.current
      return isTermA ? -c.current : c.current;
    }
  }

  wires.forEach(w => {
    // from 단자에서 도선으로 나가는 전류 (양수 = from→to 방향)
    const fromLeaving = currentLeavingTerminal(w.from);

    if (fromLeaving !== null) {
      w.current = fromLeaving;
    } else {
      // from이 스위치/접점 → to 단자에서 역추론 (부호 반전)
      const toLeaving = currentLeavingTerminal(w.to);
      if (toLeaving !== null) {
        w.current = -toLeaving;
      } else {
        w.current = 0;
      }
    }

    if (Math.abs(w.current) < 0.0001) w.current = 0;
  });

  // 닫힌 스위치 내부 전류 보정 (인접 도선 전류 평균값으로 추산)
  comps.forEach(c => {
    if (c.type === 'switch' && !c.isOpen) {
      const connectedWires = wires.filter(w => w.from.component === c || w.to.component === c);
      if (connectedWires.length > 0) {
        let sumCurrent = 0;
        connectedWires.forEach(w => sumCurrent += Math.abs(w.current));
        c.current = (sumCurrent / connectedWires.length) *
          (nodeVoltages[c.terminals[0].nodeIndex] >= nodeVoltages[c.terminals[1].nodeIndex] ? 1 : -1);
      }
    }
  });
}

// 가우스 소거법으로 선형 방정식 풀이 유틸
function solveLinearSystem(A, B) {
  const n = B.length;

  for (let i = 0; i < n; i++) {
    // 피벗 찾기
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }

    // 행 바꿈
    const tempRow = A[i];
    A[i] = A[maxRow];
    A[maxRow] = tempRow;

    const tempVal = B[i];
    B[i] = B[maxRow];
    B[maxRow] = tempVal;

    // 대각 원소가 거의 0이면 풀 수 없음 (Singular matrix)
    if (Math.abs(A[i][i]) < 1e-12) {
      return null;
    }

    // 아래 행들 소거
    for (let k = i + 1; k < n; k++) {
      const factor = A[k][i] / A[i][i];
      B[k] -= factor * B[i];
      for (let j = i; j < n; j++) {
        A[k][j] -= factor * A[i][j];
      }
    }
  }

  // 역대입 (Back substitution)
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) {
      sum += A[i][j] * x[j];
    }
    x[i] = (B[i] - sum) / A[i][i];
  }

  return x;
}

// ==========================================
// 5. 캔버스 렌더링 및 애니메이션 관리
// ==========================================
const canvas = document.getElementById('circuit-canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvas-container');

// 캔버스 크기를 컨테이너 크기에 실시간 맞춤
function resizeCanvas() {
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  drawCircuit();
}

window.addEventListener('resize', resizeCanvas);

// 선분 대 직사각형(AABB) 수학적 교차 검사 알고리즘 (오토커넥트용)
function lineRectIntersect(x1, y1, x2, y2, rx, ry, rw, rh) {
  // 선분의 끝점이 직사각형 내부인지 검사
  if (x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) return true;
  if (x2 >= rx && x2 <= rx + rw && y2 >= ry && y2 <= ry + rh) return true;
  
  const left = rx;
  const right = rx + rw;
  const top = ry;
  const bottom = ry + rh;
  
  // 선분 대 선분 교차 판단 보조 함수
  function lineLineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return false;
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  }
  
  return lineLineIntersect(x1, y1, x2, y2, left, top, right, top) ||
         lineLineIntersect(x1, y1, x2, y2, right, top, right, bottom) ||
         lineLineIntersect(x1, y1, x2, y2, right, bottom, left, bottom) ||
         lineLineIntersect(x1, y1, x2, y2, left, bottom, left, top);
}

// 소자 드롭 시 도선 자동 절단 및 직렬 삽입 (오토커넥트)
function checkAndAutoConnect(comp) {
  const box = comp.getBoundingBox();
  const myTerminalIds = comp.terminals.map(t => t.id);
  
  let wireToSplit = null;
  
  for (let w of state.wires) {
    // 소자 자체가 직접 물려 있는 도선은 제외 (무한 연결 방지)
    if (myTerminalIds.includes(w.from.id) || myTerminalIds.includes(w.to.id)) {
      continue;
    }
    
    // 도선의 실제 렌더링 경로 분절 획득
    const points = getWirePoints(w.from, w.to, w.id, w.midOffset);
    let isIntersecting = false;
    
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i+1];
      if (lineRectIntersect(p1.x, p1.y, p2.x, p2.y, box.x, box.y, box.width, box.height)) {
        isIntersecting = true;
        break;
      }
    }
    
    if (isIntersecting) {
      wireToSplit = w;
      break; // 첫 번째 감지된 도선을 끊고 삽입
    }
  }
  
  if (wireToSplit) {
    const w = wireToSplit;
    
    if (comp.type === 'junction') {
      // Junction has only 1 terminal. Split the wire and connect both sides to the junction's single terminal!
      state.wires = state.wires.filter(item => item !== w);
      
      state.wires.push({
        id: 'wire_' + Math.random().toString(36).substr(2, 9),
        from: w.from,
        to: comp.terminals[0],
        current: 0,
        midOffset: { x: 0, y: 0 }
      });
      
      state.wires.push({
        id: 'wire_' + Math.random().toString(36).substr(2, 9),
        from: comp.terminals[0],
        to: w.to,
        current: 0,
        midOffset: { x: 0, y: 0 }
      });
      
      setInstructionText('접점이 기존 도선 위에 얹어져 자동으로 연결되었습니다!');
      return;
    }
    
    // 도선의 from 단자와 comp 두 단자 간 거리 측정하여 극성/방향 매칭
    const fromCoords = w.from.getAbsoluteCoords();
    const t0Coords = comp.terminals[0].getAbsoluteCoords();
    const t1Coords = comp.terminals[1].getAbsoluteCoords();
    
    const d0 = Math.hypot(fromCoords.x - t0Coords.x, fromCoords.y - t0Coords.y);
    const d1 = Math.hypot(fromCoords.x - t1Coords.x, fromCoords.y - t1Coords.y);
    
    let nearTerminal, farTerminal;
    if (d0 < d1) {
      nearTerminal = comp.terminals[0];
      farTerminal = comp.terminals[1];
    } else {
      nearTerminal = comp.terminals[1];
      farTerminal = comp.terminals[0];
    }
    
    // 기존 도선 제거
    state.wires = state.wires.filter(item => item !== w);
    
    // 신규 분할 도선 2개 생성
    state.wires.push({
      id: 'wire_' + Math.random().toString(36).substr(2, 9),
      from: w.from,
      to: nearTerminal,
      current: 0,
      midOffset: { x: 0, y: 0 }
    });
    
    state.wires.push({
      id: 'wire_' + Math.random().toString(36).substr(2, 9),
      from: farTerminal,
      to: w.to,
      current: 0,
      midOffset: { x: 0, y: 0 }
    });
    
    setInstructionText('소자가 기존 도선 위에 얹어져 자동으로 연결되었습니다!');
  }
}

// 단자가 소자에서 향하는 방향(외향 단위 벡터) 계산
// 소자 회전에 따라 단자가 왼쪽/오른쪽/위/아래로 나오는 방향을 반환
function getTerminalStubDir(terminal) {
  const comp = terminal.component;
  // junction은 방향 없음 (중심 단자)
  if (comp.type === 'junction') return { x: 0, y: 0 };

  // 회전 전 기준: relX < width/2 이면 왼쪽 단자, 아니면 오른쪽 단자
  const isLeftSide = terminal.relX < comp.width / 2;
  const rot = comp.rotation;

  if (rot === 0)   return isLeftSide ? { x: -1, y:  0 } : { x:  1, y:  0 };
  if (rot === 90)  return isLeftSide ? { x:  0, y: -1 } : { x:  0, y:  1 };
  if (rot === 180) return isLeftSide ? { x:  1, y:  0 } : { x: -1, y:  0 };
  /* 270 */        return isLeftSide ? { x:  0, y:  1 } : { x:  0, y: -1 };
}

// 도선 경로 계산 — 스텁(Stub) + 직사각형 라우팅
// 각 단자에서 STUB_LENGTH px 만큼 직선으로 먼저 뻗어나온 후 직각으로 연결하여
// 항상 직사각형 형태의 깔끔한 회로 외형을 형성합니다.
const STUB_LENGTH = 24;

// midOffset: {x, y} — 도선 중간 세그먼트를 드래그로 이동한 오프셋
function getWirePoints(from, to, wireId, midOffset) {
  const p1 = from.getAbsoluteCoords();
  const p2 = to.getAbsoluteCoords();

  const dir1 = getTerminalStubDir(from);
  const dir2 = getTerminalStubDir(to);

  // 스텁 끝점: 단자에서 dir 방향으로 STUB_LENGTH만큼 뻗어나간 지점
  const stub1 = { x: p1.x + dir1.x * STUB_LENGTH, y: p1.y + dir1.y * STUB_LENGTH };
  const stub2 = { x: p2.x + dir2.x * STUB_LENGTH, y: p2.y + dir2.y * STUB_LENGTH };

  // 연속으로 동일한 좌표 필터링 헬퍼
  const filterPoints = (pts) => {
    const result = [];
    for (let i = 0; i < pts.length; i++) {
      if (i === 0 || Math.abs(pts[i].x - pts[i-1].x) > 0.5 || Math.abs(pts[i].y - pts[i-1].y) > 0.5) {
        result.push(pts[i]);
      }
    }
    return result;
  };

  const dir1IsHoriz = dir1.y === 0;
  const dir2IsHoriz = dir2.y === 0;

  // junction 처리: 방향이 {0,0}이면 단순 L자 연결
  const isJunction1 = dir1.x === 0 && dir1.y === 0;
  const isJunction2 = dir2.x === 0 && dir2.y === 0;
  if (isJunction1 || isJunction2) {
    const dx = stub2.x - stub1.x;
    const dy = stub2.y - stub1.y;
    if (Math.abs(dy) < 4) {
      return filterPoints([p1, { x: p2.x, y: p1.y }, p2]);
    } else if (Math.abs(dx) < 4) {
      return filterPoints([p1, { x: p1.x, y: p2.y }, p2]);
    }
    return filterPoints([p1, { x: p2.x, y: p1.y }, p2]);
  }

  let midPoints = [];

  if (dir1IsHoriz && dir2IsHoriz) {
    // 두 스텁 모두 수평 방향
    if (Math.sign(dir1.x) === Math.sign(dir2.x)) {
      // ✅ 같은 방향 (예: 둘 다 왼쪽 or 둘 다 오른쪽)
      // → 가장 바깥쪽 X까지 나간 뒤 세로로 연결 (직사각형 U자형)
      const cornerX = dir1.x < 0
        ? Math.min(stub1.x, stub2.x)   // 둘 다 왼쪽 → 가장 왼쪽 꼭짓점
        : Math.max(stub1.x, stub2.x);  // 둘 다 오른쪽 → 가장 오른쪽 꼭짓점
      midPoints = [
        { x: cornerX, y: stub1.y },
        { x: cornerX, y: stub2.y }
      ];
    } else {
      // 반대 방향 (왼쪽+오른쪽) → 서로 마주보며 L자 연결
      midPoints = [{ x: stub2.x, y: stub1.y }];
    }
  } else if (!dir1IsHoriz && !dir2IsHoriz) {
    // 두 스텁 모두 수직 방향
    if (Math.sign(dir1.y) === Math.sign(dir2.y)) {
      // ✅ 같은 방향 (예: 둘 다 위 or 둘 다 아래)
      // → 가장 바깥쪽 Y까지 나간 뒤 가로로 연결 (직사각형 U자형)
      const cornerY = dir1.y < 0
        ? Math.min(stub1.y, stub2.y)   // 둘 다 위 → 가장 높은 꼭짓점
        : Math.max(stub1.y, stub2.y);  // 둘 다 아래 → 가장 낮은 꼭짓점
      midPoints = [
        { x: stub1.x, y: cornerY },
        { x: stub2.x, y: cornerY }
      ];
    } else {
      // 반대 방향 (위+아래) → L자 연결
      midPoints = [{ x: stub1.x, y: stub2.y }];
    }
  } else {
    // 수직 × 수평 (서로 다른 축) → L자형
    if (dir1IsHoriz) {
      // stub1 수평 → 가로로 가다가 stub2 수직 축에서 꺾임
      midPoints = [{ x: stub2.x, y: stub1.y }];
    } else {
      // stub1 수직 → 세로로 가다가 stub2 수평 축에서 꺾임
      midPoints = [{ x: stub1.x, y: stub2.y }];
    }
  }

  // midOffset 적용: 중간 제어점들을 오프셋만큼 이동하여 세그먼트 드래그 구현
  if (midOffset && (midOffset.x !== 0 || midOffset.y !== 0)) {
    for (let i = 0; i < midPoints.length; i++) {
      midPoints[i] = {
        x: midPoints[i].x + midOffset.x,
        y: midPoints[i].y + midOffset.y
      };
    }
  }

  return filterPoints([p1, stub1, ...midPoints, stub2, p2]);
}

// 도선 렌더링 함수


function drawWires(ctx) {
  state.wires.forEach(w => {
    const points = getWirePoints(w.from, w.to, w.id, w.midOffset);
    const isSelected = (state.selectedWire === w);

    ctx.save();
    
    // 도선 외형 네온 스타일링
    const isFlowing = Math.abs(w.current) > 0.001;
    
    if (isSelected) {
      // 선택된 도선: 분홍색 발광 윤곽선 및 두꺼운 베이스
      ctx.shadowColor = '#ff4081';
      ctx.shadowBlur = 15;
      ctx.strokeStyle = 'rgba(255, 64, 129, 0.4)';
      ctx.lineWidth = 10;
    } else {
      ctx.strokeStyle = isFlowing ? 'rgba(0, 229, 255, 0.4)' : '#37474f';
      ctx.lineWidth = 6;
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // 도선 본체 그리기
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // 안쪽 밝은 구리 도선 코어 선
    if (isSelected) {
      ctx.strokeStyle = '#ff4081'; // 핑크색 inner 코어
      ctx.lineWidth = 4;
    } else {
      ctx.strokeStyle = isFlowing ? varColor('--accent-cyan') : '#78909c';
      ctx.lineWidth = 2.5;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // 전자(혹은 전류) 흐름 파티클 애니메이션 시각화!
    if (state.options.showElectrons && isFlowing) {
      const currentDirection = Math.sign(w.current);
      // electrons 모드: 전류 반대(전자 방향) / current 모드: 전류 방향
      const dirFactor = state.options.flowDirection === 'electrons' ? -currentDirection : currentDirection;
      const speed = Math.min(Math.abs(w.current) * 15, 60);
      
      // dirFactor > 0 이면 points 순서대로, < 0 이면 역순으로 경로를 구성
      // → 항상 양수 offset으로만 처리하여 항상 한 방향 이동 보장
      const drawPoints = dirFactor >= 0 ? points : [...points].reverse();
      
      // 경로 전체 길이 기반 offset 계산 (항상 양수)
      const offset = (state.animationTime * speed) % 40;

      if (isSelected) {
        ctx.strokeStyle = '#ffeb3b';
      } else {
        ctx.strokeStyle = state.options.flowDirection === 'electrons' ? varColor('--electron-color') : varColor('--accent-yellow');
      }
      ctx.lineWidth = isSelected ? 4.5 : 3.5;
      ctx.lineCap = 'round';
      
      ctx.setLineDash([8, 12]);
      ctx.lineDashOffset = -offset; // 항상 음수(-) offset → 시작점에서 끝점 방향으로 이동
      
      ctx.beginPath();
      ctx.moveTo(drawPoints[0].x, drawPoints[0].y);
      for (let i = 1; i < drawPoints.length; i++) {
        ctx.lineTo(drawPoints[i].x, drawPoints[i].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  });
}

// 캔버스 드로잉 전체 총괄
function drawCircuit() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.save();
  
  // 패닝 & 확대 축소 매트릭스 변환 적용
  ctx.translate(state.transform.x, state.transform.y);
  ctx.scale(state.transform.scale, state.transform.scale);

  // 1. 실험판 격자 그리기 (Grid Pattern)
  const viewLeft = -state.transform.x / state.transform.scale;
  const viewTop = -state.transform.y / state.transform.scale;
  const viewWidth = canvas.width / state.transform.scale;
  const viewHeight = canvas.height / state.transform.scale;

  // 격자선 렌더링
  ctx.strokeStyle = varColor('--bg-grid-line');
  ctx.lineWidth = 1;
  
  const startX = Math.floor(viewLeft / GRID_SIZE) * GRID_SIZE;
  const endX = startX + viewWidth + GRID_SIZE;
  const startY = Math.floor(viewTop / GRID_SIZE) * GRID_SIZE;
  const endY = startY + viewHeight + GRID_SIZE;

  for (let x = startX; x < endX; x += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, viewTop);
    ctx.lineTo(x, viewTop + viewHeight);
    ctx.stroke();
  }
  for (let y = startY; y < endY; y += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(viewLeft, y);
    ctx.lineTo(viewLeft + viewWidth, y);
    ctx.stroke();
  }

  // 2. 도선들 그리기
  drawWires(ctx);

  // 3. 단자 연결 드래그 중에 임시로 연결 대기선 그리기
  if (state.interaction.mode === 'draw-wire' && state.interaction.activeTerminal) {
    const startCoords = state.interaction.activeTerminal.getAbsoluteCoords();
    const endCoords = state.interaction.tempWireEnd;

    ctx.save();
    ctx.strokeStyle = varColor('--accent-pink');
    ctx.lineWidth = 4;
    ctx.setLineDash([5, 5]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const path = state.interaction.tempWirePath;
    if (path && path.length > 0) {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      
      const p1 = path[path.length - 1];
      const isHoriz = path.length >= 2 ? Math.abs(p1.y - path[path.length-2].y) < 1 : true;
      if (isHoriz) {
         ctx.lineTo(p1.x, endCoords.y);
      } else {
         ctx.lineTo(endCoords.x, p1.y);
      }
      ctx.lineTo(endCoords.x, endCoords.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(startCoords.x, startCoords.y);
      ctx.lineTo(endCoords.x, endCoords.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 4. 회로 소자들 그리기
  state.components.forEach(c => {
    c.draw(ctx, state.animationTime);
  });

  ctx.restore();
}

// 지속적인 렌더링 루프
function animationLoop(timestamp) {
  state.animationTime = timestamp / 1000;
  drawCircuit();
  requestAnimationFrame(animationLoop);
}

// ==========================================
// 6. 마우스 / 터치 인터랙션 통합 제어
// ==========================================

// 캔버스 마우스/터치 절대 좌표 -> 캔버스 내부 월드 좌표 변환
function screenToWorldCoords(screenX, screenY) {
  const rect = canvas.getBoundingClientRect();
  const x = (screenX - rect.left - state.transform.x) / state.transform.scale;
  const y = (screenY - rect.top - state.transform.y) / state.transform.scale;
  return { x, y };
}

// 점-선분 기하학 거리 계산 함수 (도선 클릭 감지용)
function sqr(x) { return x * x; }
function dist2(v, w) { return sqr(v.x - w.x) + sqr(v.y - w.y); }
function distToSegmentSquared(p, v, w) {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}
function distToSegment(p, v, w) {
  return Math.sqrt(distToSegmentSquared(p, v, w));
}

// 클릭 지점 주변의 도선을 탐색 — 클릭된 세그먼트 정보도 함께 반환
function findWireAt(worldX, worldY) {
  const p = { x: worldX, y: worldY };
  const tolerance = 12; // 12px 허용 오차 반경
  
  for (let i = state.wires.length - 1; i >= 0; i--) {
    const w = state.wires[i];
    const points = getWirePoints(w.from, w.to, w.id, w.midOffset);
    for (let j = 0; j < points.length - 1; j++) {
      const dist = distToSegment(p, points[j], points[j+1]);
      if (dist <= tolerance) {
        // 세그먼트의 방향 감지: 수평(isHoriz=true) or 수직(isHoriz=false)
        const isHorizSeg = Math.abs(points[j].y - points[j+1].y) < 2;
        // 스텁 세그먼트(첫번째/마지막)는 드래그 불가
        const isStubSeg = (j === 0 || j === points.length - 2);
        return { wire: w, isHorizSeg, isStubSeg };
      }
    }
  }
  return null;
}

// 특정 도선을 선택했을 때 상태 관리 및 UI 연동
function selectWire(wire) {
  // 소자 선택 해제
  state.components.forEach(c => c.selected = false);
  state.selectedComponent = null;
  
  state.selectedWire = wire;
  
  const noSelectMsg = document.getElementById('no-select-msg');
  const propertyEditor = document.getElementById('property-editor');
  const wireEditor = document.getElementById('wire-editor');
  
  noSelectMsg.classList.remove('active');
  propertyEditor.classList.add('hidden');
  wireEditor.classList.remove('hidden');
  document.getElementById('analysis-panel').classList.remove('hidden');
  
  // 옴의 법칙 수치 표시창을 도선 전류 상태로 업데이트
  const vDisp = document.getElementById('dash-v-val');
  const iDisp = document.getElementById('dash-i-val');
  const rDisp = document.getElementById('dash-r-val');
  const detailBox = document.getElementById('formula-detail-box') || {};
  
  const current = Math.abs(wire.current);
  vDisp.textContent = '0.00 V';
  iDisp.textContent = `${current.toFixed(2)} A`;
  rDisp.textContent = '0.00 Ω (도선)';
  
  detailBox.innerHTML = `
    <div style="font-weight: 500; margin-bottom: 6px; color: var(--accent-pink);">
      🔌 선택된 도선의 상태
    </div>
    <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
      도선은 저항이 거의 0Ω에 가까운 완벽한 도체로 가정합니다. 현재 이 도선에 흐르는 전류는 <strong>${current.toFixed(2)}A</strong> 이며, 도선 양 끝의 전압차는 <strong>0.00V</strong> 입니다.
    </p>
  `;
  
  setInstructionText('선택한 도선은 밝은 핑크색으로 발광합니다. 좌측 메뉴에서 삭제할 수 있습니다.');
}

// 1) 특정 터치 위치에 단자(Terminal)가 있는지 탐색
function findTerminalAt(worldX, worldY) {
  const clickTolerance = 18; // 손가락 터치를 배려한 넉넉한 히트 반경!
  for (let c of state.components) {
    for (let t of c.terminals) {
      const coords = t.getAbsoluteCoords();
      const dist = Math.hypot(coords.x - worldX, coords.y - worldY);
      if (dist <= clickTolerance) {
        return t;
      }
    }
  }
  return null;
}

// 2) 특정 위치에 소자가 있는지 탐색
function findComponentAt(worldX, worldY) {
  // 뒤에 생성된 소자가 위에 있으므로 역순 탐색
  for (let i = state.components.length - 1; i >= 0; i--) {
    const c = state.components[i];
    if (c.containsPoint(worldX, worldY)) {
      return c;
    }
  }
  return null;
}

// 공통 마우스/터치 시작 핸들러
function handlePointerDown(e) {
  // 모바일 멀티 터치 (핀치 줌) 감지
  if (e.touches && e.touches.length === 2) {
    state.interaction.mode = 'pinch';
    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    state.interaction.pinchStartDist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
    state.interaction.pinchStartScale = state.transform.scale;
    return;
  }

  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);
  
  if (clientX === undefined || clientY === undefined) return;

  const world = screenToWorldCoords(clientX, clientY);

  state.interaction.startX = clientX;
  state.interaction.startY = clientY;
  state.interaction.lastX = clientX;
  state.interaction.lastY = clientY;
  state.interaction.startTime = Date.now(); // 터치/클릭 시작 시각 기록

  // 1단계: 클릭 범위 내에 단자가 있는지 검사 (단자가 있으면 도선 연결 모드로 전환)
  const clickedTerminal = findTerminalAt(world.x, world.y);
  if (clickedTerminal) {
    state.interaction.mode = 'draw-wire';
    state.interaction.activeTerminal = clickedTerminal;
    state.interaction.tempWireEnd = { x: world.x, y: world.y };
    
    const p = clickedTerminal.getAbsoluteCoords();
    const dir = getTerminalStubDir(clickedTerminal);
    const stub = { x: p.x + dir.x * STUB_LENGTH, y: p.y + dir.y * STUB_LENGTH };
    state.interaction.tempWirePath = [p, stub, {x: stub.x, y: stub.y}];
    state.interaction.tempWireDir = dir.y === 0 ? 'H' : 'V';
    
    setInstructionText('다른 소자의 단자로 드래그하여 도선을 연결해 주세요.');
    return;
  }

  // 2단계: 클릭 범위 내에 소자 바디가 있는지 검사 (소자가 있으면 드래그 모드로 전환)
  const clickedComp = findComponentAt(world.x, world.y);
  if (clickedComp) {
    state.interaction.mode = 'drag-comp';
    state.interaction.draggedComponent = clickedComp;
    selectComponent(clickedComp);
    
    // 소자 이동을 위한 상대 오프셋 설정
    state.interaction.dragOffset = {
      x: world.x - clickedComp.x,
      y: world.y - clickedComp.y
    };
    return;
  }

  // 3단계: 도선 클릭 확인 (소자보다 먼저 체크하면 도선이 묻힐 수 있어 여기서 처리)
  const wireHit = findWireAt(world.x, world.y);
  if (wireHit) {
    const { wire, isHorizSeg, isStubSeg } = wireHit;
    if (!wire.midOffset) wire.midOffset = { x: 0, y: 0 };

    if (state.selectedWire === wire && !isStubSeg) {
      // 이미 선택된 도선의 중간 세그먼트를 다시 클릭 → 드래그 시작
      state.interaction.mode = 'drag-wire-segment';
      state.interaction.draggedWire = wire;
      state.interaction.dragWireIsHoriz = isHorizSeg; // 수평 세그먼트면 Y만, 수직이면 X만 이동
      canvas.style.cursor = isHorizSeg ? 'ns-resize' : 'ew-resize';
      setInstructionText('도선을 드래그하여 경로를 조절하세요. 마우스를 놓으면 고정됩니다.');
    } else {
      // 처음 클릭 → 선택만
      selectWire(wire);
    }
    return;
  }

  // 4단계: 아무것도 없다면 빈 배경 클릭 -> 캔버스 패닝 모드 전환
  state.interaction.mode = 'pan';
  canvas.style.cursor = 'grabbing';
}

// 공통 마우스/터치 이동 핸들러
function handlePointerMove(e) {
  // 핀치 줌 진행
  if (state.interaction.mode === 'pinch' && e.touches && e.touches.length === 2) {
    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
    
    const factor = dist / state.interaction.pinchStartDist;
    let newScale = state.interaction.pinchStartScale * factor;
    
    // 확대 축소 비율 제한 (40% ~ 200%)
    newScale = Math.max(0.4, Math.min(newScale, 4.0));
    
    // 캔버스 중심을 기준으로 줌
    const rect = canvas.getBoundingClientRect();
    const midX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
    const midY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
    
    zoomAt(midX, midY, newScale);
    return;
  }

  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);
  
  if (clientX === undefined || clientY === undefined) return;

  const dx = clientX - state.interaction.lastX;
  const dy = clientY - state.interaction.lastY;
  
  const world = screenToWorldCoords(clientX, clientY);

  // 1. 캔버스 패닝 모드 처리
  if (state.interaction.mode === 'pan') {
    state.transform.x += dx;
    state.transform.y += dy;
  }
  // 0. 정지 상태: 선택된 도선 위에 마우스가 올라왔을 때 커서 변경 (드래그 힌트)
  else if (state.interaction.mode === 'none') {
    const wireHit = findWireAt(world.x, world.y);
    if (wireHit && state.selectedWire === wireHit.wire && !wireHit.isStubSeg) {
      canvas.style.cursor = wireHit.isHorizSeg ? 'ns-resize' : 'ew-resize';
    } else {
      canvas.style.cursor = 'grab';
    }
  }
  // 2. 소자 드래그 모드 처리
  else if (state.interaction.mode === 'drag-comp' && state.interaction.draggedComponent) {
    const comp = state.interaction.draggedComponent;
    
    // 마우스 드래그 오프셋을 적용하고 그리드 격자 스냅 적용
    let newX = world.x - state.interaction.dragOffset.x;
    let newY = world.y - state.interaction.dragOffset.y;

    comp.x = Math.round(newX / GRID_SIZE) * GRID_SIZE;
    comp.y = Math.round(newY / GRID_SIZE) * GRID_SIZE;
    
    // 소자가 화면 아주 밖으로 이탈하지 않도록 격자 범위 보정 가능
    solveCircuit(); // 위치 이동 시 혹시 모를 레이아웃 변화에 의한 재계산
  } 
  // 3. 도선 연결선 드래그 처리
  else if (state.interaction.mode === 'draw-wire') {
    state.interaction.tempWireEnd = { x: world.x, y: world.y };
    
    if (!state.interaction.tempWirePath) {
      const p = state.interaction.activeTerminal.getAbsoluteCoords();
      const dir = getTerminalStubDir(state.interaction.activeTerminal);
      const stub = { x: p.x + dir.x * STUB_LENGTH, y: p.y + dir.y * STUB_LENGTH };
      state.interaction.tempWirePath = [p, stub, {x: stub.x, y: stub.y}];
      state.interaction.tempWireDir = dir.y === 0 ? 'H' : 'V';
    }
    
    let path = state.interaction.tempWirePath;
    let dir = state.interaction.tempWireDir;
    
    if (path.length > 3) {
      let p_prev = path[path.length - 2];
      if (dir === 'H' && Math.abs(world.x - p_prev.x) < 15) {
        path.pop();
        state.interaction.tempWireDir = 'V';
        dir = 'V';
      } else if (dir === 'V' && Math.abs(world.y - p_prev.y) < 15) {
        path.pop();
        state.interaction.tempWireDir = 'H';
        dir = 'H';
      }
    }
    
    let p1 = path[path.length - 1];
    
    if (dir === 'H') {
      p1.x = world.x;
      if (Math.abs(world.y - p1.y) > 25) {
         path.push({ x: p1.x, y: world.y });
         state.interaction.tempWireDir = 'V';
      }
    } else {
      p1.y = world.y;
      if (Math.abs(world.x - p1.x) > 25) {
         path.push({ x: world.x, y: p1.y });
         state.interaction.tempWireDir = 'H';
      }
    }
  }
  // 4. 도선 세그먼트 드래그 처리 (선택된 도선 늘리기/당기기)
  else if (state.interaction.mode === 'drag-wire-segment' && state.interaction.draggedWire) {
    const wire = state.interaction.draggedWire;
    if (!wire.midOffset) wire.midOffset = { x: 0, y: 0 };
    const worldDx = dx / state.transform.scale;
    const worldDy = dy / state.transform.scale;
    if (state.interaction.dragWireIsHoriz) {
      // 수평 세그먼트 → 상하(Y)로만 이동
      wire.midOffset.y += worldDy;
    } else {
      // 수직 세그먼트 → 좌우(X)로만 이동
      wire.midOffset.x += worldDx;
    }
  }

  state.interaction.lastX = clientX;
  state.interaction.lastY = clientY;
}

// 공통 마우스/터치 마침 핸들러
function handlePointerUp(e) {
  // 클릭/탭 판정 (마우스 클릭 혹은 터치 탭 모두 대응)
  const dx = state.interaction.lastX - state.interaction.startX;
  const dy = state.interaction.lastY - state.interaction.startY;
  const dist = Math.hypot(dx, dy);
  const elapsed = Date.now() - state.interaction.startTime;
  const isTap = dist < 8 && elapsed < 300; // 8픽셀 미만 이동, 300ms 미만 유지시 클릭/탭으로 판정

  if (isTap) {
    const world = screenToWorldCoords(state.interaction.lastX, state.interaction.lastY);
    const comp = findComponentAt(world.x, world.y);
    
    if (comp && comp.type === 'switch') {
      comp.isOpen = !comp.isOpen;
      setInstructionText(`스위치를 ${comp.isOpen ? '열었습니다.' : '닫았습니다.'}`);
    } else if (!comp) {
      const clickedTerminal = findTerminalAt(world.x, world.y);
      if (!clickedTerminal) {
        const clickedWire = findWireAt(world.x, world.y);
        if (clickedWire) {
          selectWire(clickedWire.wire);
        } else {
          deselectAll();
        }
      }
    }
  }

  if (state.interaction.mode === 'drag-comp' && state.interaction.draggedComponent) {
    const comp = state.interaction.draggedComponent;
    checkAndAutoConnect(comp);
  }

  if (state.interaction.mode === 'draw-wire' && state.interaction.activeTerminal) {
    const world = screenToWorldCoords(state.interaction.lastX, state.interaction.lastY);
    const targetTerminal = findTerminalAt(world.x, world.y);

    // 유효한 다른 단자를 만났고 다른 소스의 단자일 경우에만 전선 연결 승인!
    if (targetTerminal && targetTerminal !== state.interaction.activeTerminal && targetTerminal.component !== state.interaction.activeTerminal.component) {
      
      // 이미 두 단자 사이에 동일한 전선 연결이 있다면 중복 방지
      const duplicate = state.wires.find(w => 
        (w.from === state.interaction.activeTerminal && w.to === targetTerminal) ||
        (w.from === targetTerminal && w.to === state.interaction.activeTerminal)
      );

      if (!duplicate) {
        state.wires.push({
          id: 'wire_' + Math.random().toString(36).substr(2, 9),
          from: state.interaction.activeTerminal,
          to: targetTerminal,
          current: 0,
          midOffset: { x: 0, y: 0 }
        });

        setInstructionText('도선이 올바르게 연결되었습니다!');
        solveCircuit();
      }
    } else {
      setInstructionText('도선 연결을 취소했습니다. 단자와 단자를 연결해 주세요.');
    }
  }

  // 초기화
  state.interaction.mode = 'none';
  state.interaction.activeTerminal = null;
  state.interaction.draggedComponent = null;
  state.interaction.draggedWire = null;
  canvas.style.cursor = 'grab';
  
  // 전체 계산 재수행
  solveCircuit();
}

// 특정 지점을 기준으로 줌 연산 처리
function zoomAt(clientX, clientY, newScale) {
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;

  // 줌 직전의 마우스 위치에 대칭되는 월드 좌표 구하기
  const worldX = (localX - state.transform.x) / state.transform.scale;
  const worldY = (localY - state.transform.y) / state.transform.scale;

  state.transform.scale = newScale;
  
  // 새로운 배율에 맞게 패닝 오프셋 역보정하여 줌인한 마우스 커서 아래에 물체가 정위치하게 만듦!
  state.transform.x = localX - worldX * newScale;
  state.transform.y = localY - worldY * newScale;
}

// ==========================================
// 7. UI 제어 및 이벤트 연동
// ==========================================

// 안내 정보 텍스트 표시 업데이트
function setInstructionText(msg) {
  document.getElementById('instruction-text').textContent = msg;
}

// 특정 소자를 선택했을 때 세부 정보창 및 옴의 법칙 카드 연동
function selectComponent(comp) {
  // 이전 선택된 소자 선택 해제
  state.components.forEach(c => c.selected = false);
  
  state.selectedComponent = comp;
  comp.selected = true;
  state.selectedWire = null; // 선택된 도선 해제

  const editor = document.getElementById('property-editor');
  const noSelectMsg = document.getElementById('no-select-msg');
  const wireEditor = document.getElementById('wire-editor');

  noSelectMsg.classList.remove('active');
  editor.classList.remove('hidden');
  wireEditor.classList.add('hidden'); // 도선 조작 패널 숨김
  document.getElementById('analysis-panel').classList.remove('hidden');

  // UI 요소 셋업
  const typeTag = document.getElementById('selected-type-tag');
  const voltCont = document.getElementById('prop-voltage-container');
  const resCont = document.getElementById('prop-resistance-container');
  const resColorBox = document.getElementById('resistor-color-code-box');

  // 디폴트 다 숨김 후 타입별 오픈
  voltCont.style.display = 'none';
  resCont.style.display = 'none';
  resColorBox.style.display = 'none';

  if (comp.type === 'battery') {
    typeTag.textContent = '배터리 (전력 전원)';
    typeTag.style.backgroundColor = 'rgba(255, 64, 129, 0.15)';
    typeTag.style.color = '#ff4081';
    typeTag.style.borderColor = 'rgba(255, 64, 129, 0.25)';

    voltCont.style.display = 'block';
    
    const slider = document.getElementById('voltage-slider');
    slider.value = comp.value;
    document.getElementById('voltage-val-display').textContent = `${comp.value.toFixed(1)}V`;
    
    setInstructionText('배터리 전압(V)을 마우스나 터치 슬라이더로 변경해 보세요.');
  } 
  else if (comp.type === 'resistor' || comp.type === 'bulb') {
    const isBulb = comp.type === 'bulb';
    typeTag.textContent = isBulb ? '전구' : '저항기';
    typeTag.style.backgroundColor = 'rgba(0, 229, 255, 0.15)';
    typeTag.style.color = '#00e5ff';
    typeTag.style.borderColor = 'rgba(0, 229, 255, 0.25)';

    resCont.style.display = 'block';
    if (!isBulb) {
      resColorBox.style.display = 'block';
      updateColorCodePanel(comp.value);
    }

    const slider = document.getElementById('resistance-slider');
    slider.value = comp.value;
    document.getElementById('resistance-val-display').textContent = `${comp.value.toFixed(0)}Ω`;
    
    setInstructionText(`${isBulb ? '전구' : '저항기'}의 저항값(Ω)을 올려 전류 흐름을 조절해 보세요.`);
  } 
  else if (comp.type === 'switch') {
    typeTag.textContent = '스위치';
    typeTag.style.backgroundColor = 'rgba(255, 235, 59, 0.15)';
    typeTag.style.color = '#ffeb3b';
    typeTag.style.borderColor = 'rgba(255, 235, 59, 0.25)';
    
    setInstructionText('캔버스의 스위치를 클릭해 회로를 연결하거나 차단할 수 있습니다.');
  }
  else if (comp.type === 'junction') {
    typeTag.textContent = '연결 접점 (정션)';
    typeTag.style.backgroundColor = 'rgba(120, 144, 156, 0.15)';
    typeTag.style.color = '#78909c';
    typeTag.style.borderColor = 'rgba(120, 144, 156, 0.25)';
    
    setInstructionText('연결 접점을 통해 여러 도선을 한 자리에 모아 분기 회로를 구성할 수 있습니다.');
  }
  else if (comp.type === 'ammeter' || comp.type === 'voltmeter') {
    const isAmmeter = comp.type === 'ammeter';
    typeTag.textContent = isAmmeter ? '전류계' : '전압계';
    typeTag.style.backgroundColor = isAmmeter ? 'rgba(255, 64, 129, 0.15)' : 'rgba(0, 229, 255, 0.15)';
    typeTag.style.color = isAmmeter ? '#ff4081' : '#00e5ff';
    typeTag.style.borderColor = isAmmeter ? 'rgba(255, 64, 129, 0.25)' : 'rgba(0, 229, 255, 0.25)';
    
    setInstructionText(`${isAmmeter ? '전류계' : '전압계'}는 회로의 실시간 측정 장비입니다.`);
  }

  // 옴의 법칙 라이브 업데이트
  updateOhmsLawDashboard(comp);
}

// 아무것도 선택 안된 디폴트 상태 복원
function deselectAll() {
  state.components.forEach(c => c.selected = false);
  state.selectedComponent = null;
  state.selectedWire = null; // 선택된 도선 해제

  document.getElementById('no-select-msg').classList.add('active');
  document.getElementById('property-editor').classList.add('hidden');
  document.getElementById('wire-editor').classList.add('hidden'); // 도선 조작 패널 숨김
  document.getElementById('analysis-panel').classList.add('hidden');

  // 대시보드 리셋
  document.getElementById('dash-v-val').textContent = '--';
  document.getElementById('dash-i-val').textContent = '--';
  document.getElementById('dash-r-val').textContent = '--';
  
  const fBox = document.getElementById('formula-detail-box');
  if (fBox) fBox.innerHTML = `
    <p class="formula-explain">저항 소자를 선택하면 옴의 법칙 계산식이 여기에 자세히 활성화됩니다.</p>
  `;
}

// 옴의 법칙 대시보드 그래픽 패널 업데이트
function updateOhmsLawDashboard(comp) {
  const vDisp = document.getElementById('dash-v-val');
  const iDisp = document.getElementById('dash-i-val');
  const rDisp = document.getElementById('dash-r-val');
  const detailBox = document.getElementById('formula-detail-box') || {};

  if (comp.type === 'resistor' || comp.type === 'bulb') {
    const v = comp.voltageDiff;
    const i = Math.abs(comp.current);
    const r = comp.value;

    vDisp.textContent = `${v.toFixed(2)} V`;
    iDisp.textContent = `${i.toFixed(2)} A`;
    rDisp.textContent = `${r.toFixed(0)} Ω`;

    // 옴의 법칙 설명 박스에 아름다운 반응형 분수 수식 삽입!
    detailBox.innerHTML = `
      <div style="font-weight: 500; margin-bottom: 6px; color: var(--accent-yellow);">
        💡 이 저항기의 옴의 법칙 계산
      </div>
      <div class="formula-fraction-block">
        <div>전류(I) = </div>
        <div class="fraction">
          <span class="num v-color">전압 (V)</span>
          <span class="den r-color">저항 (R)</span>
        </div>
        <div> &nbsp;⇒&nbsp; </div>
        <div>
          ${i.toFixed(2)}A = 
          <div class="fraction" style="display:inline-flex;">
            <span class="num v-color">${v.toFixed(1)}V</span>
            <span class="den r-color">${r.toFixed(0)}Ω</span>
          </div>
        </div>
      </div>
      <p style="font-size:11px; margin-top:8px; color:var(--text-muted); line-height:1.4;">
        저항값(${r.toFixed(0)}Ω)이 커질수록 도선에 흐르는 전류의 세기는 정비례하여 감소하고, 양단의 걸린 전압(${v.toFixed(1)}V)이 커질수록 전류는 정비례하여 증가합니다.
      </p>
    `;
  } else if (comp.type === 'battery') {
    vDisp.textContent = `${comp.value.toFixed(1)} V`;
    iDisp.textContent = `${Math.abs(comp.current).toFixed(2)} A`;
    rDisp.textContent = '0.00 Ω (전원)';

    detailBox.innerHTML = `
      <div style="font-weight: 500; margin-bottom: 6px; color: var(--accent-pink);">
        🔋 배터리의 상태
      </div>
      <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
        전체 회로에 <strong>${comp.value.toFixed(1)}V</strong>의 압력(전압)을 밀어주고 있으며, 현재 배터리에서 나가는 전체 전류는 <strong>${Math.abs(comp.current).toFixed(2)}A</strong>입니다.
      </p>
    `;
  } else if (comp.type === 'junction') {
    vDisp.textContent = '0.00 V';
    iDisp.textContent = '0.00 A';
    rDisp.textContent = '0.00 Ω (접점)';

    detailBox.innerHTML = `
      <div style="font-weight: 500; margin-bottom: 6px; color: #78909c;">
        🔘 연결 접점 (Junction)
      </div>
      <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
        이 노드는 여러 개의 전선이 만나는 결합점입니다. 들어오는 전류와 나가는 전류의 합은 키르히호프의 전류 법칙(KCL)에 의해 항상 <strong>0</strong>이 됩니다.
      </p>
    `;
  } else if (comp.type === 'ammeter' || comp.type === 'voltmeter') {
    const isAmmeter = comp.type === 'ammeter';
    vDisp.textContent = isAmmeter ? '0.00 V' : `${comp.voltageDiff.toFixed(2)} V`;
    iDisp.textContent = isAmmeter ? `${Math.abs(comp.current).toFixed(2)} A` : '0.00 A';
    rDisp.textContent = isAmmeter ? '0.00 Ω (전류계)' : '∞ Ω (전압계)';
  } else {
    vDisp.textContent = '--';
    iDisp.textContent = '--';
    rDisp.textContent = '--';
    detailBox.innerHTML = `
      <p class="formula-explain">저항기나 전구를 캔버스에서 선택해야 정확한 옴의 법칙 실시간 공식이 산출됩니다.</p>
    `;
  }
}

// 저항기 아래의 색띠 가이드 텍스트 업데이트
function updateColorCodePanel(ohms) {
  const bands = getResistorColorBands(ohms);
  
  const b1 = document.getElementById('band-1-meaning');
  const b2 = document.getElementById('band-2-meaning');
  const b3 = document.getElementById('band-3-meaning');
  const b4 = document.getElementById('band-4-meaning');

  b1.textContent = `${bands[0].name} (${bands[0].value})`;
  b1.style.borderLeftColor = bands[0].color;
  
  b2.textContent = `${bands[1].name} (${bands[1].value})`;
  b2.style.borderLeftColor = bands[1].color;

  // 배수 표현
  let multText = '';
  if (bands[2].multiplier >= 1000) {
    multText = `x${bands[2].multiplier/1000}k`;
  } else {
    multText = `x${bands[2].multiplier}`;
  }
  b3.textContent = `${bands[2].name} (${multText})`;
  b3.style.borderLeftColor = bands[2].color;

  b4.textContent = `${GOLD_BAND.name} (${GOLD_BAND.tolerance})`;
  b4.style.borderLeftColor = GOLD_BAND.color;

  // 저항 모형 색띠도 업데이트
  const previewBands = document.querySelectorAll('.band-resistor-body .band');
  previewBands.forEach((pb, idx) => {
    pb.style.backgroundColor = bands[idx].color;
  });
}

// 8. 이벤트 바인딩 설정 총괄
function initEventBindings() {
  
  // 1) 소자 추가 버튼 클릭 이벤트 (도구 상자)
  const addCompFn = (type) => {
    // 새 소자의 크기 파악
    const tempComp = new Component(type, 0, 0);
    const W = tempComp.width + 40;   // 소자 너비 + 여백
    const H = tempComp.height + 60;  // 소자 높이 + 수치 표시 여백

    // ── 캔버스 정중앙 월드 좌표 ──
    const worldCenter = screenToWorldCoords(canvas.width / 2, canvas.height / 2);
    const centerX = Math.round((worldCenter.x - W / 2) / GRID_SIZE) * GRID_SIZE;
    const centerY = Math.round((worldCenter.y - H / 2) / GRID_SIZE) * GRID_SIZE;

    // 기존 소자들의 점유 영역 (여백 포함)
    const occupied = state.components.map(c => {
      const box = c.getBoundingBox();
      return { x: box.x - 20, y: box.y - 20, w: box.width + 40, h: box.height + 40 };
    });

    const overlaps = (x, y) =>
      occupied.some(r =>
        x < r.x + r.w && x + W > r.x &&
        y < r.y + r.h && y + H > r.y
      );

    // ── 중앙에서 시작해 오른쪽→아래 방향으로 빈 자리 탐색 ──
    const step = GRID_SIZE * 9; // 탐색 간격 (~180px)
    let placeX = centerX;
    let placeY = centerY;

    if (overlaps(centerX, centerY)) {
      let found = false;
      outer:
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 8; col++) {
          const cx = centerX + col * step;
          const cy = centerY + row * step;
          if (!overlaps(cx, cy)) {
            placeX = cx;
            placeY = cy;
            found = true;
            break outer;
          }
        }
      }
      // 탐색 실패 시 중앙에 그냥 배치
      if (!found) {
        placeX = centerX;
        placeY = centerY;
      }
    }

    const comp = new Component(type, placeX, placeY);
    state.components.push(comp);
    selectComponent(comp);
    solveCircuit();
  };

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      addCompFn(btn.getAttribute('data-type'));
    });
  });

  document.querySelectorAll('.mobile-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      addCompFn(btn.getAttribute('data-type'));
    });
  });

  // 샘플 회로 선택기 이벤트 바인딩
  const sampleSelect = document.getElementById('circuit-sample-select');
  if (sampleSelect) {
    sampleSelect.addEventListener('change', (e) => {
      loadSampleCircuit(e.target.value);
    });
  }

  // 2) 캔버스 마우스/터치 바인딩
  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseup', handlePointerUp);

  // 모바일 터치 이벤트 바인딩 (수동 preventDefault를 주어 스크롤 꼬임 방지)
  canvas.addEventListener('touchstart', (e) => {
    // 핀치 줌이 아닐 때만 터치 고유 브라우저 액션 차단
    if (e.touches.length < 2) e.preventDefault();
    handlePointerDown(e);
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length < 2) e.preventDefault();
    handlePointerMove(e);
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    handlePointerUp(e);
  });

  // 더블 클릭 시 소자 및 도선 즉시 삭제
  canvas.addEventListener('dblclick', (e) => {
    const clientX = e.clientX;
    const clientY = e.clientY;
    const world = screenToWorldCoords(clientX, clientY);

    const comp = findComponentAt(world.x, world.y);
    if (comp) {
      state.selectedComponent = comp;
      document.getElementById('delete-selected').click();
      return;
    }
    
    const wireHit = findWireAt(world.x, world.y);
    if (wireHit) {
      state.selectedWire = wireHit.wire;
      document.getElementById('delete-selected-wire').click();
    }
  });



  // 3) 슬라이더 실시간 조작 바인딩
  const voltSlider = document.getElementById('voltage-slider');
  voltSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('voltage-val-display').textContent = `${val.toFixed(1)}V`;
    if (state.selectedComponent && state.selectedComponent.type === 'battery') {
      state.selectedComponent.value = val;
      solveCircuit();
      updateOhmsLawDashboard(state.selectedComponent);
    }
  });

  const resSlider = document.getElementById('resistance-slider');
  resSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('resistance-val-display').textContent = `${val.toFixed(0)}Ω`;
    if (state.selectedComponent && (state.selectedComponent.type === 'resistor' || state.selectedComponent.type === 'bulb')) {
      state.selectedComponent.value = val;
      solveCircuit();
      updateOhmsLawDashboard(state.selectedComponent);
      if (state.selectedComponent.type === 'resistor') {
        updateColorCodePanel(val);
      }
    }
  });

  // 4) 설정 조작 패널 바인딩
  document.getElementById('toggle-electrons').addEventListener('change', (e) => {
    state.options.showElectrons = e.target.checked;
  });

  document.querySelectorAll('input[name="flow-direction"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.options.flowDirection = e.target.value;
    });
  });

  document.getElementById('toggle-values').addEventListener('change', (e) => {
    state.options.showValues = e.target.checked;
  });

  document.getElementById('toggle-symbols').addEventListener('change', (e) => {
    state.options.showSymbols = e.target.checked;
    solveCircuit();
  });

  // 5) 액션 버튼 바인딩 (초기화 및 삭제)
  document.getElementById('clear-circuit').addEventListener('click', () => {
    if (confirm('만들고 계신 회로 구성을 모두 삭제하고 초기 실험 상태로 리셋하시겠습니까?')) {
      state.components = [];
      state.wires = [];
      deselectAll();
      setInstructionText('회로가 초기화되었습니다. 왼쪽 메뉴에서 소자를 클릭하여 회로를 만들어 보세요!');
      solveCircuit();
    }
  });

  document.getElementById('delete-selected').addEventListener('click', () => {
    if (state.selectedComponent) {
      const comp = state.selectedComponent;
      
      // 1. 소자에 달린 단자들과 엮여 있는 전선들 모두 완벽 제거
      const termIds = comp.terminals.map(t => t.id);
      state.wires = state.wires.filter(w => !termIds.includes(w.from.id) && !termIds.includes(w.to.id));
      
      // 2. 소자 리스트에서 제거
      state.components = state.components.filter(c => c !== comp);
      
      deselectAll();
      setInstructionText('선택한 소자를 삭제했습니다.');
      solveCircuit();
    }
  });

  // 5-1) 소자 90도 회전 및 도선 개별 삭제 바인딩
  document.getElementById('rotate-selected').addEventListener('click', () => {
    if (state.selectedComponent) {
      const comp = state.selectedComponent;
      comp.rotation = (comp.rotation + 90) % 360;
      solveCircuit();
      updateOhmsLawDashboard(comp);
      setInstructionText('소자를 90도 회전했습니다.');
    }
  });

  document.getElementById('delete-selected-wire').addEventListener('click', () => {
    if (state.selectedWire) {
      const wire = state.selectedWire;
      state.wires = state.wires.filter(w => w !== wire);
      deselectAll();
      setInstructionText('선택한 도선을 삭제했습니다.');
      solveCircuit();
    }
  });

  // 6) 줌 컨트롤러 바인딩
  document.getElementById('zoom-in').addEventListener('click', () => {
    let scale = Math.min(state.transform.scale + 0.15, 4.0);
    zoomAt(canvas.width / 2, canvas.height / 2, scale);
  });

  document.getElementById('zoom-out').addEventListener('click', () => {
    let scale = Math.max(state.transform.scale - 0.15, 0.4);
    zoomAt(canvas.width / 2, canvas.height / 2, scale);
  });

  document.getElementById('zoom-reset').addEventListener('click', () => {
    state.transform.scale = 1.8;
    // 캔버스 중앙에 오게 뷰포트 이동
    state.transform.x = 0;
    state.transform.y = 0;
  });

  document.getElementById('canvas-center').addEventListener('click', () => {
    if (state.components.length === 0) {
      state.transform.x = 0;
      state.transform.y = 0;
      state.transform.scale = 1.8;
      return;
    }

    // 모든 배치된 소자의 중심점 계산하여 중앙 배치
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    state.components.forEach(c => {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x + c.width);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y + c.height);
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    state.transform.scale = 1.8;
    state.transform.x = canvas.width / 2 - centerX * 1.8;
    state.transform.y = canvas.height / 2 - centerY * 1.8;
  });

  // 7) 테마 토글 버튼 바인딩
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-mode');
      localStorage.setItem('ohm-theme', isLight ? 'light' : 'dark');
      // 캔버스를 즉시 새로 그려서 테마 색상 반영
      drawCircuit();
    });
  }

  // 캔버스 영역 휠(스크롤) 줌인/아웃 지원 (PC 및 맥북 트랙패드 지원)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.05;
    let newScale = state.transform.scale - e.deltaY * zoomIntensity * 0.01;
    newScale = Math.max(0.4, Math.min(newScale, 4.0));
    zoomAt(e.clientX, e.clientY, newScale);
  }, { passive: false });
}

// ==========================================
// 9. 초기화 및 기본 회로 구성 설정
// ==========================================
function initDefaultCircuit() {
  // 초기 회로 상태를 빈 회로로 설정
  state.components = [];
  state.wires = [];

  // 뷰포트 위치 초기화
  state.transform.x = 0;
  state.transform.y = 0;
  state.transform.scale = 1.8;

  deselectAll();
  solveCircuit();
}

function loadSampleCircuit(index) {
  state.components = [];
  state.wires = [];
  deselectAll();
  
  state.transform.x = 0;
  state.transform.y = 0;
  state.transform.scale = 1.8;

  if (index === '0') {
    solveCircuit();
    return;
  }
  
  const addComp = (type, x, y, val, rot=0) => {
    const c = new Component(type, x, y);
    if (val !== undefined) c.value = val;
    c.rotation = rot;
    state.components.push(c);
    return c;
  };
  
  const addWire = (c1, t1, c2, t2) => {
    state.wires.push({
      id: 'wire_' + Math.random().toString(36).substr(2, 9),
      from: c1.terminals[t1],
      to: c2.terminals[t2],
      current: 0,
      midOffset: { x: 0, y: 0 }
    });
  };

  let bat, sw;

  if (index === '1') {
    bat = addComp('battery', 0, 200, 10, 0);
    sw = addComp('switch', -150, -150, 0, 0);
    const res = addComp('resistor', 150, -150, 5, 0);
    
    sw.isOpen = false;
    addWire(sw, 0, bat, 0);
    addWire(sw, 1, res, 0);
    addWire(res, 1, bat, 1);
  }
  else if (index === '2') {
    bat = addComp('battery', 0, 200, 12, 0);
    sw = addComp('switch', -200, -150, 0, 0);
    const r1 = addComp('resistor', 0, -150, 4, 0);
    const r2 = addComp('resistor', 200, -150, 2, 0);
    
    sw.isOpen = false;
    addWire(sw, 0, bat, 0);
    addWire(sw, 1, r1, 0);
    addWire(r1, 1, r2, 0);
    addWire(r2, 1, bat, 1);
  }
  else if (index === '3') {
    bat = addComp('battery', 0, 200, 12, 0);
    sw = addComp('switch', -150, -150, 0, 0);
    const r1 = addComp('resistor', 150, -220, 6, 0);
    const r2 = addComp('resistor', 150, -80, 3, 0);
    
    sw.isOpen = false;
    addWire(sw, 0, bat, 0);
    addWire(sw, 1, r1, 0);
    addWire(sw, 1, r2, 0);
    addWire(r1, 1, bat, 1);
    addWire(r2, 1, bat, 1);
  }
  else if (index === '4') {
    bat = addComp('battery', 0, 200, 12, 0);
    sw = addComp('switch', -300, -150, 0, 0);
    const r1 = addComp('resistor', -100, -150, 2, 0);
    const r2 = addComp('resistor', 100, -150, 4, 0);
    const r3 = addComp('resistor', 300, -150, 6, 0);
    
    sw.isOpen = false;
    addWire(sw, 0, bat, 0);
    addWire(sw, 1, r1, 0);
    addWire(r1, 1, r2, 0);
    addWire(r2, 1, r3, 0);
    addWire(r3, 1, bat, 1);
  }
  else if (index === '5') {
    bat = addComp('battery', 0, 280, 12, 0);
    sw = addComp('switch', -160, -150, 0, 0);
    const r1 = addComp('resistor', 160, -330, 6, 0);
    const r2 = addComp('resistor', 160, -150, 4, 0);
    const r3 = addComp('resistor', 160, 30, 12, 0);
    
    sw.isOpen = false;
    addWire(sw, 0, bat, 0);
    addWire(sw, 1, r1, 0);
    addWire(sw, 1, r2, 0);
    addWire(sw, 1, r3, 0);
    addWire(r1, 1, bat, 1);
    addWire(r2, 1, bat, 1);
    addWire(r3, 1, bat, 1);
  }
  else if (index === '6') {
    bat = addComp('battery', 0, 200, 12, 0);
    sw = addComp('switch', -200, -150, 0, 0);
    const rs = addComp('resistor', 0, -150, 2, 0);
    const rp1 = addComp('resistor', 200, -220, 6, 0);
    const rp2 = addComp('resistor', 200, -80, 3, 0);
    
    sw.isOpen = false;
    addWire(sw, 0, bat, 0);
    addWire(sw, 1, rs, 0);
    addWire(rs, 1, rp1, 0);
    addWire(rs, 1, rp2, 0);
    addWire(rp1, 1, bat, 1);
    addWire(rp2, 1, bat, 1);
  }
  else if (index === '7') {
    bat = addComp('battery', 0, 200, 18, 0);
    sw = addComp('switch', -250, -150, 0, 0);
    const r11 = addComp('resistor', 0, -220, 6, 0);
    const r12 = addComp('resistor', 0, -80, 3, 0);
    const r21 = addComp('resistor', 250, -220, 2, 0);
    const r22 = addComp('resistor', 250, -80, 2, 0);
    
    sw.isOpen = false;
    addWire(sw, 0, bat, 0);
    addWire(sw, 1, r11, 0);
    addWire(sw, 1, r12, 0);
    addWire(r11, 1, r12, 1); // Group 1 right side node
    addWire(r11, 1, r21, 0);
    addWire(r11, 1, r22, 0);
    addWire(r21, 1, bat, 1);
    addWire(r22, 1, bat, 1);
  }
  
  solveCircuit();
  
  // 회로가 모두 배치된 후 화면 정중앙에 위치하도록 캔버스 센터 맞춤 버튼 강제 클릭 트리거
  setTimeout(() => {
    document.getElementById('canvas-center').click();
  }, 10);
}


// 앱 구동 개시
window.addEventListener('load', () => {
  resizeCanvas();
  initEventBindings();
  
  // 브라우저 렌더 레이아웃이 끝난 시점에 맞추기 위해 타임아웃 뒤 기본회로 로드
  setTimeout(() => {
    resizeCanvas();
    initDefaultCircuit();
  }, 100);

  // 애니메이션 구동 개시
  requestAnimationFrame(animationLoop);
});
