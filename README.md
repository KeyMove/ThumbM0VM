
# ThumbM0VM — ARM Thumb 指令集仿真引擎
一个基于 JavaScript 的单文件库，集成了 **Thumb 汇编器**、**反汇编器** 和 **CPU 虚拟机**。它允许你在浏览器或 Node.js 环境中编写、编译、执行和分析 ARM Thumb 指令集代码。
---
## 🚀 功能特性
- **汇编器**: 支持将 ARM Thumb 汇编文本转换为机器码。
  - 支持标签和分支跳转。
  - 支持 `LDR Rd, =value` 伪指令，自动生成字面量池。
  - 支持多种寻址模式（立即数、寄存器间接等）。
- **反汇编器**: 将机器码还原为可读的汇编文本。
  - 带地址和机器码注释的详细输出。
  - 自动解析 PC 相对地址。
- **CPU 虚拟机**: 一个轻量级的 ARM Thumb CPU 模拟器。
  - 实现了 R0-R12、SP、LR、PC 寄存器。
  - 支持 CPSR 状态标志位。
  - 支持基础 ALU 运算、内存读写、栈操作和分支跳转。
- **纯 JavaScript 实现**: 无任何外部依赖，单文件即可运行，兼容 Node.js 和浏览器环境。
---
## 📦 安装与引入
### Node.js 环境
将 `thumbsc.js` 放入项目目录，通过 `require` 引入：
```javascript
const { ThumbM0, ThumbCPU } = require('./thumbsc.js');
```
### 浏览器环境
直接通过 `<script>` 标签引入：
```html
<script src="thumbsc.js"></script>
<script>
  // 类将在 window 下可用，如 new ThumbM0()
</script>

---
## 📖 使用指南
### 1. 汇编
将汇编字符串编译为字节数组。
```javascript
const asm = new ThumbM0();
const asmCode = `
  MOV R0, #10    ; R0 = 10
  MOV R1, #20    ; R1 = 20
  ADD R2, R0, R1 ; R2 = R0 + R1
`;
const bytes = asm.parseASM(asmCode);
console.log(bytes); // 输出 Uint8Array 字节码
```
### 2. 执行
将编译后的字节码加载到 CPU 并运行。
```javascript
const cpu = new ThumbCPU();
// 将字节数组加载到内存地址 0
cpu.loadProgram(new Uint8Array(bytes), 0);
// 运行 3 条指令
cpu.run(3);
// 打印寄存器状态
console.log(cpu.dumpRegs());
// 输出示例: { R0: 10, R1: 20, R2: 30, ... }
```
### 3. 反汇编
将字节码还原为汇编文本。
```javascript
const disasm = asm.parseThumb(bytes, true);
console.log(disasm);
// 输出带有地址和机器码的文本
// :08000000 0020 MOVS R0, #10
// :08000002 4140 MOVS R1, #20
// :08000004 1840 ADDS R2, R0, R1
```
---
## 🏗️ 核心类说明
### `ThumbM0` (汇编器 & 反汇编器)
负责指令的文本解析、编码和二进制解码。
- `parseASM(asmStr)`: 编译汇编字符串为 `Uint8Array`。
- `parseThumb(bytes, addrView)`: 反汇编 `Uint8Array` 为字符串。
- `encodeThumb(line)`: 内部方法，负责单行指令编码。
**支持的伪指令：**
- `LDR Rd, =数值`: 自动将数值放入字面量池并加载。
### `ThumbCPU` (虚拟机)
模拟 ARM CPU 的硬件行为。
- `loadProgram(data, addr)`: 加载程序到内存并设置 PC。
- `run(count)`: 执行指定数量的指令。
- `reset()`: 重置 CPU 状态。
- `dumpRegs()`: 导出当前寄存器快照。
**实现的寄存器：**
- 通用寄存器: R0-R12
- 特殊寄存器: SP (R13), LR (R14), PC (R15)
- 状态寄存器: CPSR (标志位 N, Z, C, V)
### `ThumbMemory` (内存管理)
模拟线性内存空间。
- 默认大小为 0x10000 (64KB)。
- 提供字节、半字和字的读写接口。
---
## ⚙️ 支持的指令集范围
本项目覆盖了 ARM Thumb 指令集的核心子集，包括但不限于：
- **数据处理**: `MOV`, `ADD`, `SUB`, `MUL`, `AND`, `ORR`, `EOR`, `LSL`, `LSR`, `ASR`, `ROR` 等。
- **比较与测试**: `CMP`, `CMN`, `TST`。
- **内存加载/存储**: `LDR`, `STR`, `LDRB`, `STRB`, `LDRH`, `STRH` (支持寄存器偏移和立即数偏移)。
- **栈操作**: `PUSH`, `POP`。
- **分支跳转**: `B`, `BX`, `BL` 以及所有条件跳转 (`BEQ`, `BNE`, `BGE` 等)。
- **其他**: `NOP`, `REV`, `SXTH`, `SXTB` 等。
---
## 📝 代码示例：标签与循环
```javascript
const asm = new ThumbM0();
const cpu = new ThumbCPU();
const code = `
  MOV R0, #5      ; 计数器
loop:
  ADD R0, #-1     ; 减 1
  CMP R0, #0      ; 比较
  BNE loop        ; 如果不相等则跳转
`;
const bytes = asm.parseASM(code);
cpu.loadProgram(bytes, 0);
// 由于不知道确切指令数，可以设置较大的循环次数或在虚拟机内部判断
// 这里为了演示，我们可以手动运行多次直到 R0 变为 0
while (cpu.getReg(0) !== 0) {
    cpu.run(1); 
    console.log('R0:', cpu.getReg(0));
}
console.log('Done!');
```
---
## 📄 许可
本项目文件 `thumbsc.js` 为集成实现，代码结构清晰，适合学习 ARM 指令集原理或嵌入式开发的前端仿真应用。
---
## 🛠️ 开发者备注
- **字面量池**: 汇编器会自动处理 `LDR =` 伪指令，将其转换为 PC 相对加载，并将数据放置在代码段末尾对齐的位置。
- **指令编码**: 内部使用 `thumbgenMap` 进行复杂的二进制位模式匹配，支持解码和编码的一致性。
- **执行**: 虚拟机采用大 `switch-case` 结构按指令格式分发执行效率较高。
