/**
 * ThumbSC — ARM Thumb 指令集 汇编器 + 反汇编器 + CPU 虚拟机
 * ============================================================
 * 单文件集成三大功能:
 *   - ThumbM0:   汇编(asm→byte) / 反汇编(byte→asm)
 *   - ThumbCPU:  CPU 执行虚拟机
 *
 * Usage:
 *   const { ThumbM0, ThumbCPU } = require('./thumbsc.js');
 *
 *   // --- 汇编 ---
 *   const asm = new ThumbM0();
 *   const bytes = asm.parseASM('MOV R0, #42\nMOV R1, #10\nADD R2, R0, R1');
 *
 *   // --- 执行 ---
 *   const cpu = new ThumbCPU();
 *   cpu.loadProgram(new Uint8Array(bytes), 0);
 *   cpu.run(3);
 *   console.log(cpu.dumpRegs());
 *
 *   // --- 反汇编 ---
 *   const disasm = asm.parseThumb(bytes, true);
 *   console.log(disasm);
 */

// ============================================================
// 常量
// ============================================================
const REG = Object.freeze({
    R0:0,R1:1,R2:2,R3:3,R4:4,R5:5,R6:6,R7:7,
    R8:8,R9:9,R10:10,R11:11,R12:12,
    SP:13, LR:14, PC:15, CPSR:16
});

const I0=1,I1=2,I7=128,I8=256,I9=512,I10=1024,I11=2048,I12=4096;
const L1=1,L2=3,L3=7,L4=15,L5=31,L7=127,L8=255,L10=1023,L11=2047;
const FT=32,FQ=1<<27,FV=1<<28,FC=1<<29,FZ=1<<30,FN=1<<31;

// ============================================================
// 内存
// ============================================================
class ThumbMemory {
    constructor(size=0x10000) {
        this.buffer=new Uint8Array(size);
        this.size=size;
    }
    loadProgram(data,addr=0){ for(let i=0;i<data.length;i++) this.buffer[addr+i]=data[i]; }
    readByte(a){ a>>>=0; return a>=this.size?0:this.buffer[a]; }
    readShort(a){ a>>>=0; return a+1>=this.size?0:(this.buffer[a]|(this.buffer[a+1]<<8))&0xFFFF; }
    readInt(a){ a>>>=0; return a+3>=this.size?0:(this.buffer[a]|(this.buffer[a+1]<<8)|(this.buffer[a+2]<<16)|(this.buffer[a+3]<<24)); }
    writeByte(a,v){ a>>>=0; if(a<this.size) this.buffer[a]=v&0xFF; }
    writeShort(a,v){ a>>>=0; if(a+1<this.size){ this.buffer[a]=v&0xFF; this.buffer[a+1]=(v>>8)&0xFF; }}
    writeInt(a,v){ a>>>=0; if(a+3<this.size){ this.buffer[a]=v&0xFF; this.buffer[a+1]=(v>>8)&0xFF; this.buffer[a+2]=(v>>16)&0xFF; this.buffer[a+3]=(v>>24)&0xFF; }}
}

// ============================================================
// CPU 虚拟机
// ============================================================
class ThumbCPU {
    constructor(memSize=0x10000){
        this.R=new Int32Array(REG.CPSR+1);
        this.R[REG.CPSR]=FT;
        this.memory=new ThumbMemory(memSize);
    }
    reset(){ this.R.fill(0); this.R[REG.CPSR]=FT; }
    loadProgram(data,addr=0,setPC=true){ this.memory.loadProgram(data,addr); if(setPC) this.R[REG.PC]=addr; }
    getReg(i){ return this.R[i]; }
    dumpRegs(){
        const r={};
        for(let i=0;i<=12;i++) r[`R${i}`]=this.R[i];
        r.SP=this.R[REG.SP]; r.LR=this.R[REG.LR]; r.PC=this.R[REG.PC]; r.CPSR=this.R[REG.CPSR];
        return r;
    }

    run(count){
        const R=this.R, mem=this.memory;
        let q=!!(R[REG.CPSR]&FQ), v=!!(R[REG.CPSR]&FV), c=!!(R[REG.CPSR]&FC);
        let z=!!(R[REG.CPSR]&FZ), n=!!(R[REG.CPSR]&FN);
        R[REG.PC]&=~I0;

        const Add=(a,b)=>(a>>>0)+(b>>>0);
        const Sub=(a,b)=>((a>>>0)-(b>>>0))+0x100000000;
        const SetNZ=val=>{ n=val<0; z=val===0; };
        const SetC=lval=>{ c=lval>0xFFFFFFFF; };
        const SetV_Add=(val,a,b)=>{ v=!!((a^val)&(b^val)&FN); };
        const SetV_Sub=(val,a,b)=>SetV_Add(val,a,~b+1);

        try{
            while(count-->0){
                let incr_pc=true,Rs,Rd,Rb,left,right,value,addr,lvalue,uleft,uvalue,L,B,S,H,list,Ro;
                const code=mem.readShort(R[REG.PC]);

                switch((code>>12)&L4){

                    // ---- Format 1&2: 移位/加减 ----
                    case 0:case 1:
                        Rs=(code>>3)&L3; Rd=code&L3; left=R[Rs];
                        switch((code>>11)&L2){
                            case 0: // LSL
                                right=(code>>6)&L5; uleft=left>>>0;
                                uvalue=(uleft<<right)>>>0; value=uvalue|0;
                                if(right>0) c=!!((uleft<<(right-1))&FN);
                                break;
                            case 1: // LSR
                                right=(code>>6)&L5;
                                if(right===0){ value=0; c=!!(left&FN); }
                                else{ uleft=left>>>0; uvalue=uleft>>>right; value=uvalue|0; c=!!(left&(1<<(right-1))); }
                                break;
                            case 2: // ASR
                                right=(code>>6)&L5;
                                if(right===0){ value=(left>>31)>>1; c=!!(left&FN); }
                                else{ value=left>>right; c=!!(left&(1<<(right-1))); }
                                break;
                            case 3: // ADD/SUB 3-op
                                const imm=!!((code>>10)&1), Rn=(code>>6)&L3;
                                Rs=(code>>3)&L3; Rd=code&L3; left=R[Rs]; right=imm?Rn:R[Rn];
                                if((code>>9)&1){ lvalue=Sub(left,right); value=lvalue|0; SetC(lvalue); SetV_Sub(value,left,right); }
                                else{ lvalue=Add(left,right); value=lvalue|0; SetC(lvalue); SetV_Add(value,left,right); }
                                break;
                        }
                        SetNZ(value); R[Rd]=value;
                        break;

                    // ---- Format 3: 立即数 MOV/CMP/ADD/SUB ----
                    case 2:case 3:
                        Rd=(code>>8)&L3; left=R[Rd]; right=code&L8;
                        switch((code>>11)&L2){
                            case 0: value=right; R[Rd]=value; break;
                            case 1: lvalue=Sub(left,right); value=lvalue|0; SetC(lvalue); SetV_Sub(value,left,right); break;
                            case 2: lvalue=Add(left,right); value=lvalue|0; R[Rd]=value; SetC(lvalue); SetV_Add(value,left,right); break;
                            case 3: lvalue=Sub(left,right); value=lvalue|0; R[Rd]=value; SetC(lvalue); SetV_Sub(value,left,right); break;
                        }
                        SetNZ(value);
                        break;

                    // ---- Format 4-6: ALU / Hi-Reg / PC-rel ----
                    case 4:
                        switch((code>>10)&L2){
                            case 0: // ALU
                                Rs=(code>>3)&L3; Rd=code&L3; left=R[Rd]; right=R[Rs];
                                switch((code>>6)&L4){
                                    case 0: value=left&right; R[Rd]=value; break;
                                    case 1: value=left^right; R[Rd]=value; break;
                                    case 2: // LSL reg
                                        if(right>=32){ value=0; c=right===32&&!!(left&1); }
                                        else if(right<0){ value=0; c=false; }
                                        else if(right===0) value=left;
                                        else{ uleft=left>>>0; uvalue=(uleft<<right)>>>0; value=uvalue|0; c=!!((uleft<<(right-1))&FN); }
                                        R[Rd]=value; break;
                                    case 3: // LSR reg
                                        if(right>=32){ value=0; c=right===32&&!!(left&FN); }
                                        else if(right<0){ value=0; c=false; }
                                        else if(right===0) value=left;
                                        else{ uleft=left>>>0; uvalue=uleft>>>right; value=uvalue|0; c=!!((uleft>>>(right-1))&1); }
                                        R[Rd]=value; break;
                                    case 4: // ASR reg
                                        if(right<0||right>=32){ value=left>0?0:-1; c=value<0; }
                                        else if(right===0) value=left;
                                        else{ value=left>>right; c=!!(left&(1<<(right-1))); }
                                        R[Rd]=value; break;
                                    case 5:{ // ADC
                                        const full=(left>>>0)+(right>>>0)+(c?1:0);
                                        value=full|0; R[Rd]=value; c=full>0xFFFFFFFF;
                                        v=left>0&&right>0&&value<0||left<0&&right<0&&value>0; break;
                                    }
                                    case 6:{ // SBC
                                        const full=(left>>>0)-(right>>>0)-(c?0:1);
                                        value=left-right-(c?0:1); R[Rd]=value;
                                        c=c||value<0; v=(full|0)!==value; break;
                                    }
                                    case 7: // ROR
                                        uleft=left>>>0; right&=31;
                                        value=((uleft>>>right)|(uleft<<(32-right)))|0;
                                        c=!!((uleft>>>(right-1))&I0); R[Rd]=value; break;
                                    case 8: value=left&right; break; // TST
                                    case 9: lvalue=Sub(0,right); value=lvalue|0; R[Rd]=value; SetC(lvalue); SetV_Sub(value,0,right); break;
                                    case 10: lvalue=Sub(left,right); value=lvalue|0; SetC(lvalue); SetV_Sub(value,left,right); break;
                                    case 11: lvalue=Add(left,right); value=lvalue|0; SetC(lvalue); SetV_Add(value,left,right); break;
                                    case 12: value=left|right; R[Rd]=value; break;
                                    case 13:{ // MUL
                                        const sv=BigInt(left)*BigInt(right);
                                        value=Number(sv&0xFFFFFFFFn)|0; R[Rd]=value;
                                        c=c||sv>0x7FFFFFFFn||sv<-0x80000000n; v=false; break;
                                    }
                                    case 14: value=left&~right; R[Rd]=value; break;
                                    case 15: value=~right; R[Rd]=value; break;
                                }
                                SetNZ(value); break;

                            case 1:{ // Hi-reg ops / BX
                                const H1=!!((code>>7)&1), H2=!!((code>>6)&1);
                                Rd=(code&L3)+(H1?8:0); Rs=((code>>3)&L3)+(H2?8:0);
                                switch((code>>8)&L2){
                                    case 0: left=R[Rd]; right=R[Rs]; if(Rs===REG.PC) right+=4; R[Rd]=left+right; break;
                                    case 1: left=R[Rd]; right=R[Rs]; lvalue=Sub(left,right); value=lvalue|0; SetNZ(value); SetC(lvalue); SetV_Sub(value,left,right); break;
                                    case 2: value=R[Rs]; if(Rd===REG.PC) value-=2; R[Rd]=value; break;
                                    case 3: value=R[Rs]; if((value&I0)!==1) throw Error(`BX: invalid addr ${value.toString(16)}`); if(H1) R[REG.LR]=(R[REG.PC]+2)|I0; R[REG.PC]=value&~I0; incr_pc=false; break;
                                }
                                break;
                            }
                            case 2:case 3: // PC-rel LDR
                                Rd=(code>>8)&L3; addr=(code&L8)<<2; addr+=(R[REG.PC]+4)&~I1; R[Rd]=mem.readInt(addr);
                                break;
                        }
                        break;

                    // ---- Format 7&8: reg-offset load/store ----
                    case 5:
                        if(!(code&I9)){
                            L=!!(code&I11); B=!!(code&I10); Ro=(code>>6)&L3; Rb=(code>>3)&L3; Rd=code&L3;
                            addr=(R[Rb]>>>0)+(R[Ro]>>>0);
                            if(L){ if(B) R[Rd]=mem.readByte(addr); else R[Rd]=mem.readInt(addr); }
                            else{ if(B) mem.writeByte(addr,R[Rd]); else mem.writeInt(addr,R[Rd]); }
                        }else{
                            H=!!(code&I11); S=!!(code&I10); Ro=(code>>6)&L3; Rb=(code>>3)&L3; Rd=code&L3;
                            addr=(R[Rb]>>>0)+(R[Ro]>>>0);
                            if(S){ if(H){ value=mem.readShort(addr); value=(value<<16)>>16; }else{ value=mem.readByte(addr); value=(value<<24)>>24; } R[Rd]=value; }
                            else{ if(H){ value=mem.readShort(addr); R[Rd]=value; }else{ mem.writeShort(addr,R[Rd]&0xFFFF); }}
                        }
                        break;

                    // ---- Format 9: imm-offset load/store ----
                    case 6:case 7:
                        B=!!(code&I12); L=!!(code&I11); Rb=(code>>3)&L3; Rd=code&L3;
                        value=(code>>6)&L5; if(!B) value<<=2;
                        addr=(R[Rb]>>>0)+value;
                        if(L){ if(!B) value=mem.readInt(addr); else value=mem.readByte(addr); R[Rd]=value; }
                        else{ value=R[Rd]; if(!B) mem.writeInt(addr,value); else mem.writeByte(addr,value&0xFF); }
                        break;

                    // ---- Format 10: halfword ----
                    case 8:
                        L=!!(code&I11); Rb=(code>>3)&L3; Rd=code&L3;
                        value=((code>>6)&L5)<<1; addr=(R[Rb]>>>0)+value;
                        if(L) R[Rd]=mem.readShort(addr); else mem.writeShort(addr,R[Rd]&0xFFFF);
                        break;

                    // ---- Format 11: SP-relative ----
                    case 9:
                        L=!!(code&I11); Rd=(code>>8)&L3; value=(code&L8)<<2; addr=(R[REG.SP]>>>0)+value;
                        if(L) R[Rd]=mem.readInt(addr); else mem.writeInt(addr,R[Rd]);
                        break;

                    // ---- Format 12: ADR ----
                    case 10:{
                        const fSP=!!(code&I11); Rd=(code>>8)&L3; value=(code&L8)<<2;
                        if(fSP) value+=R[REG.SP]; else value+=(R[REG.PC]+4)&~I1;
                        R[Rd]=value; break;
                    }

                    // ---- Format 13&14: SP/PUSH/POP/extend/rev ----
                    case 11:
                        switch((code>>8)&L4){
                            case 0: S=!!(code&I7); value=(code&L7)<<2; if(S) R[REG.SP]-=value; else R[REG.SP]+=value; break;
                            case 1: throw Error('CBZ not implemented');
                            case 2: // SXTH/SXTB/UXTH/UXTB
                                Rs=(code>>3)&L3; Rd=code&L3; value=R[Rs];
                                switch((code>>6)&L2){ case 0: value=(value<<16)>>16; break; case 1: value=(value<<24)>>24; break; case 2: value&=0xFFFF; break; case 3: value&=0xFF; break; }
                                R[Rd]=value; break;
                            case 3: throw Error('CBNZ not implemented');
                            case 4:case 5:{ // PUSH
                                const RF=!!(code&I8); list=code&L8; addr=R[REG.SP]>>>0;
                                if(RF){ addr-=4; mem.writeInt(addr,R[REG.LR]); }
                                for(let i=7;i>=0;i--) if(list&(1<<i)){ addr-=4; mem.writeInt(addr,R[i]); }
                                R[REG.SP]=addr|0; break;
                            }
                            case 6:case 7:case 8:throw Error('Unknown instruction');
                            case 9:throw Error('CBNZ not implemented');
                            case 10: // REV
                                Rs=(code>>3)&L3; Rd=code&L3; value=R[Rs];
                                switch((code>>6)&L2){
                                    case 0: value=((value>>>24)&0xFF)|(((value>>>16)&0xFF)<<8)|(((value>>>8)&0xFF)<<16)|((value&0xFF)<<24); break;
                                    case 1: throw Error('REV16 not implemented');
                                    case 2: throw Error('Unknown instruction');
                                    case 3: throw Error('REVSH not implemented');
                                }
                                R[Rd]=value; break;
                            case 11:throw Error('CBNZ not implemented');
                            case 12:case 13:{ // POP
                                const RF=!!(code&I8); list=code&L8; addr=R[REG.SP]>>>0;
                                for(let i=0;i<8;i++) if(list&(1<<i)){ R[i]=mem.readInt(addr); addr+=4; }
                                if(RF){ value=mem.readInt(addr); if((value&I0)!==1) throw Error(`POP {PC}: invalid addr ${value.toString(16)}`); R[REG.PC]=value&~I0; addr+=4; incr_pc=false; }
                                R[REG.SP]=addr|0; break;
                            }
                            case 14:case 15:throw Error('Unknown instruction');
                        }
                        break;

                    // ---- Format 15: LDM/STM ----
                    case 12:
                        L=!!(code&I11); list=code&L8; Rb=(code>>8)&L3; addr=R[Rb]>>>0;
                        if(!L) for(let i=0;i<8;i++) if(list&(1<<i)){ mem.writeInt(addr,R[i]); addr+=4; }
                        else for(let i=0;i<8;i++) if(list&(1<<i)){ R[i]=mem.readInt(addr); addr+=4; }
                        R[Rb]=addr|0; break;

                    // ---- Format 16&17: cond branch / SWI ----
                    case 13:{
                        const soff=code&L8; let cond=false;
                        switch((code>>8)&L4){
                            case 0: cond=z; break; case 1: cond=!z; break; case 2: cond=c; break; case 3: cond=!c; break;
                            case 4: cond=n; break; case 5: cond=!n; break; case 6: cond=v; break; case 7: cond=!v; break;
                            case 8: cond=c&&!z; break; case 9: cond=!c||z; break; case 10: cond=!(n^v); break; case 11: cond=!!(n^v); break;
                            case 12: cond=!z&&!(n^v); break; case 13: cond=z||!!(n^v); break;
                            case 14: throw Error('Unknown instr(cond=1110)'); case 15: this.interrupt(soff); break;
                        }
                        if(cond){ value=(soff&L8)<<1; if(value&I8) value|=-1^L8; R[REG.PC]+=4+value; incr_pc=false; }
                        break;
                    }

                    // ---- Format 18: B ----
                    case 14:
                        if(code&I11) throw Error('Unknown instr(B bit11=1)');
                        value=(code&L10)<<1; if(code&I10) value|=-1^L11;
                        R[REG.PC]+=4+value; incr_pc=false;
                        break;

                    // ---- Format 19: BL ----
                    case 15:
                        H=!!((code>>11)&1); value=code&L11;
                        if(!H){ R[REG.LR]=value<<12; count++; }
                        else{ addr=R[REG.LR]; addr|=value<<1; if(addr&(1<<22)){ addr<<=9; addr>>=9; } const lr=R[REG.PC]; R[REG.PC]=(lr>>>0)+(addr>>>0)+2; R[REG.LR]=lr+3; incr_pc=false; }
                        break;
                }
                if(incr_pc) R[REG.PC]+=2;
            }
        }finally{
            R[REG.CPSR]=(q?FQ:0)|(v?FV:0)|(c?FC:0)|(z?FZ:0)|(n?FN:0);
        }
    }

    interrupt(soffset){ throw Error(`SWI ${soffset} not implemented`); }
}

// ============================================================
// ThumbM0 — 汇编器 + 反汇编器
// ============================================================
class ThumbM0{
    constructor(){
        this.baseAddr=0x08000000;
        this.AddrName={};
        this.thumbgenMap={};
        this.lastAddr=0;

        const genthumb=(name,req,action)=>{
            if(!this.thumbgenMap[name]) this.thumbgenMap[name]={};
            // 不做重复注册警告 (已有重叠的CMP:RR等)
            this.thumbgenMap[name][req]=action;
            return action;
        };
        const b2=(x,b)=>`000000000000000${x.toString(2)}`.slice(-b);
        const Regs=r=>r<13?(r<10?`R${r} `:`R${r}`):(['SP','LR','PC'])[r-13];
        const Bcond=(b,offset)=>`B${['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE'][b]}  ${offset&0x80?(this.lastAddr=(((offset|~255)<<1)+4)):(this.lastAddr=((offset<<1)+4))}  ;@PC+BL`;
        this.Regs=Regs;

        this.InstructionsCode={
            '000mm':{
                0:['ooooosssddd',(o,Rs,Rd)=>`LSL  ${Regs(Rd)},${Regs(Rs)},#${o}`,genthumb('LSL','ORR',(o,Rs,Rd)=>`0b00000${b2(o,5)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                1:['ooooosssddd',(o,Rs,Rd)=>`LSR  ${Regs(Rd)},${Regs(Rs)},#${o}`,genthumb('LSR','ORR',(o,Rs,Rd)=>`0b00001${b2(o,5)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                2:['ooooosssddd',(o,Rs,Rd)=>`ASR  ${Regs(Rd)},${Regs(Rs)},#${o}`,genthumb('ASR','ORR',(o,Rs,Rd)=>`0b00010${b2(o,5)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                3:{
                    'mm':{
                        0:['nnnsssddd',(Rn,Rs,Rd)=>`ADD  ${Regs(Rd)},${Regs(Rs)},${Regs(Rn)}`,genthumb('ADD','RRR',(Rn,Rs,Rd)=>`0b0001100${b2(Rn,3)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        1:['nnnsssddd',(Rn,Rs,Rd)=>`SUB  ${Regs(Rd)},${Regs(Rs)},${Regs(Rn)}`,genthumb('SUB','RRR',(Rn,Rs,Rd)=>`0b0001101${b2(Rn,3)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        2:['ooosssddd',(Rn,Rs,Rd)=>`ADD  ${Regs(Rd)},${Regs(Rs)},#${Rn}`,genthumb('ADD','ORR',(o,Rs,Rd)=>`0b0001110${b2(o,3)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        3:['ooosssddd',(Rn,Rs,Rd)=>`SUB  ${Regs(Rd)},${Regs(Rs)},#${Rn}`,genthumb('SUB','ORR',(o,Rs,Rd)=>`0b0001111${b2(o,3)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                    }
                },
            },
            '001mm':{
                0:['dddoooooooo',(Rd,o)=>`MOV  ${Regs(Rd)},#${o}`,genthumb('MOV','OR',(o,Rd)=>`0b00100${b2(Rd,3)}${b2(o,8)}`|0)],
                1:['dddoooooooo',(Rd,o)=>`CMP  ${Regs(Rd)},#${o}`,genthumb('CMP','OR',(o,Rd)=>`0b00101${b2(Rd,3)}${b2(o,8)}`|0)],
                2:['dddoooooooo',(Rd,o)=>`ADD  ${Regs(Rd)},#${o}`,genthumb('ADD','OR',(o,Rd)=>`0b00110${b2(Rd,3)}${b2(o,8)}`|0)],
                3:['dddoooooooo',(Rd,o)=>`SUB  ${Regs(Rd)},#${o}`,genthumb('SUB','OR',(o,Rd)=>`0b00111${b2(Rd,3)}${b2(o,8)}`|0)],
            },
            '0100mm':{
                0:{
                    'mmmm':{
                        0: ['sssddd',(Rs,Rd)=>`AND  ${Regs(Rd)},${Regs(Rs)}`,genthumb('AND','RR',(Rs,Rd)=>`0b010000${b2( 0,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        1: ['sssddd',(Rs,Rd)=>`EOR  ${Regs(Rd)},${Regs(Rs)}`,genthumb('EOR','RR',(Rs,Rd)=>`0b010000${b2( 1,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        2: ['sssddd',(Rs,Rd)=>`LSL  ${Regs(Rd)},${Regs(Rs)}`,genthumb('LSL','RR',(Rs,Rd)=>`0b010000${b2( 2,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        3: ['sssddd',(Rs,Rd)=>`LSR  ${Regs(Rd)},${Regs(Rs)}`,genthumb('LSR','RR',(Rs,Rd)=>`0b010000${b2( 3,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        4: ['sssddd',(Rs,Rd)=>`ASR  ${Regs(Rd)},${Regs(Rs)}`,genthumb('ASR','RR',(Rs,Rd)=>`0b010000${b2( 4,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        5: ['sssddd',(Rs,Rd)=>`ADC  ${Regs(Rd)},${Regs(Rs)}`,genthumb('ADC','RR',(Rs,Rd)=>`0b010000${b2( 5,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        6: ['sssddd',(Rs,Rd)=>`SBC  ${Regs(Rd)},${Regs(Rs)}`,genthumb('SBC','RR',(Rs,Rd)=>`0b010000${b2( 6,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        7: ['sssddd',(Rs,Rd)=>`ROR  ${Regs(Rd)},${Regs(Rs)}`,genthumb('ROR','RR',(Rs,Rd)=>`0b010000${b2( 7,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        8: ['sssddd',(Rs,Rd)=>`TST  ${Regs(Rd)},${Regs(Rs)}`,genthumb('TST','RR',(Rs,Rd)=>`0b010000${b2( 8,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        9: ['sssddd',(Rs,Rd)=>`NEG  ${Regs(Rd)},${Regs(Rs)}`,genthumb('NEG','RR',(Rs,Rd)=>`0b010000${b2( 9,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        // CMP here removed — handled by Format 5 handler below (covers both low & high regs)
                        // 10: CMP handled below
                        11:['sssddd',(Rs,Rd)=>`CMN  ${Regs(Rd)},${Regs(Rs)}`,genthumb('CMN','RR',(Rs,Rd)=>`0b010000${b2(11,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        12:['sssddd',(Rs,Rd)=>`ORR  ${Regs(Rd)},${Regs(Rs)}`,genthumb('ORR','RR',(Rs,Rd)=>`0b010000${b2(12,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        13:['sssddd',(Rs,Rd)=>`MUL  ${Regs(Rd)},${Regs(Rs)}`,genthumb('MUL','RR',(Rs,Rd)=>`0b010000${b2(13,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        14:['sssddd',(Rs,Rd)=>`BIC  ${Regs(Rd)},${Regs(Rs)}`,genthumb('BIC','RR',(Rs,Rd)=>`0b010000${b2(14,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        15:['sssddd',(Rs,Rd)=>`MVN  ${Regs(Rd)},${Regs(Rs)}`,genthumb('MVN','RR',(Rs,Rd)=>`0b010000${b2(15,4)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                    }
                },
                1:{
                    'mm':{
                        0: ['hssssddd',(h,Rs,Rd)=>`ADD  ${Regs(Rd+h*8)},${Regs(Rs)}`,genthumb('ADD','RR',(Rs,Rd)=>`0b01000100${b2(((Rd&0x8)!=0)|0,1)}${b2(Rs,4)}${b2(Rd,3)}`|0)],
                        1: ['hssssddd',(h,Rs,Rd)=>`CMP  ${Regs(Rd+h*8)},${Regs(Rs)}`,genthumb('CMP','RR',(Rs,Rd)=>((Rd<8&&Rs<8)?(`0b010000${b2(10,4)}${b2(Rs,3)}${b2(Rd,3)}`):(`0b01000101${b2(((Rd&0x8)!=0)|0,1)}${b2(Rs,4)}${b2(Rd,3)}`))|0)],
                        2: ['hssssddd',(h,Rs,Rd)=>`MOV  ${Regs(Rd+h*8)},${Regs(Rs)}`,genthumb('MOV','RR',(Rs,Rd)=>`0b01000110${b2(((Rd&0x8)!=0)|0,1)}${b2(Rs,4)}${b2(Rd,3)}`|0)],
                        3: {
                            'm':{
                                0:['ssssddd',(Rs,Rd)=>`BX    ${Regs(Rs)}`,genthumb('BX' ,'R',(Rs)=>`0b010001110${b2(Rs,4)}000`|0)],
                                1:['ssssddd',(Rs,Rd)=>`BLX   ${Regs(Rs)}`,genthumb('BLX','R',(Rs)=>`0b010001111${b2(Rs,4)}000`|0)],
                            }
                        },
                    }
                },
                2:['ddoooooooo',(Rd,o)=>`LDR  ${Regs(Rd)},[PC, #${this.lastAddr=o*4}]  ;@PC+ADDR`,genthumb('LDR','OPR',(o,Rb,Rd)=>`0b01001${b2(Rd,3)}${b2(o>>2,8)}`|0)],
                3:['ddoooooooo',(Rd,o)=>`LDR  ${Regs(Rd+4)},[PC, #${this.lastAddr=o*4}]  ;@PC+ADDR`],
            },
            '0101mmm':{
                6:['ooobbbddd',(Ro,Rb,Rd)=>`LDRB ${Regs(Rd)},[${Regs(Rb)},${Regs(Ro)}]`,genthumb('LDRB','RRR',(Ro,Rb,Rd)=>`0b0101${b2(6,3)}${b2(Ro,3)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                4:['ooobbbddd',(Ro,Rb,Rd)=>`LDR  ${Regs(Rd)},[${Regs(Rb)},${Regs(Ro)}]`,genthumb('LDR' ,'RRR',(Ro,Rb,Rd)=>`0b0101${b2(4,3)}${b2(Ro,3)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                2:['ooobbbddd',(Ro,Rb,Rd)=>`STRB ${Regs(Rd)},[${Regs(Rb)},${Regs(Ro)}]`,genthumb('STRB','RRR',(Ro,Rb,Rd)=>`0b0101${b2(2,3)}${b2(Ro,3)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                0:['ooobbbddd',(Ro,Rb,Rd)=>`STR  ${Regs(Rd)},[${Regs(Rb)},${Regs(Ro)}]`,genthumb('STR' ,'RRR',(Ro,Rb,Rd)=>`0b0101${b2(0,3)}${b2(Ro,3)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                7:['ooobbbddd',(Ro,Rb,Rd)=>`LDSH ${Regs(Rd)},[${Regs(Rb)},${Regs(Ro)}]`,genthumb('LDSH','RRR',(Ro,Rb,Rd)=>`0b0101${b2(7,3)}${b2(Ro,3)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                3:['ooobbbddd',(Ro,Rb,Rd)=>`LDSB ${Regs(Rd)},[${Regs(Rb)},${Regs(Ro)}]`,genthumb('LDSB','RRR',(Ro,Rb,Rd)=>`0b0101${b2(3,3)}${b2(Ro,3)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                5:['ooobbbddd',(Ro,Rb,Rd)=>`LDRH ${Regs(Rd)},[${Regs(Rb)},${Regs(Ro)}]`,genthumb('LDRH','RRR',(Ro,Rb,Rd)=>`0b0101${b2(5,3)}${b2(Ro,3)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                1:['ooobbbddd',(Ro,Rb,Rd)=>`STRH ${Regs(Rd)},[${Regs(Rb)},${Regs(Ro)}]`,genthumb('STRH','RRR',(Ro,Rb,Rd)=>`0b0101${b2(1,3)}${b2(Ro,3)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
            },
            '011mm':{
                3:['ooooobbbddd',(o,Rb,Rd)=>`LDRB ${Regs(Rd)},[${Regs(Rb)},#${o}]`,genthumb('LDRB','ORR',(o,Rb,Rd)=>`0b011${b2(3,2)}${b2(o,5)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                1:['ooooobbbddd',(o,Rb,Rd)=>`LDR  ${Regs(Rd)},[${Regs(Rb)},#${o*4}]`,genthumb('LDR' ,'ORR',(o,Rb,Rd)=>`0b011${b2(1,2)}${b2(o>>2,5)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                0:['ooooobbbddd',(o,Rb,Rd)=>`STR  ${Regs(Rd)},[${Regs(Rb)},#${o*4}]`,genthumb('STR' ,'ORR',(o,Rb,Rd)=>`0b011${b2(0,2)}${b2(o>>2,5)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                2:['ooooobbbddd',(o,Rb,Rd)=>`STRB ${Regs(Rd)},[${Regs(Rb)},#${o}]`,genthumb('STRB','ORR',(o,Rb,Rd)=>`0b011${b2(2,2)}${b2(o,5)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
            },
            '100mm':{
                0:['ooooobbbddd',(o,Rb,Rd)=>`STRH ${Regs(Rd)},[${Regs(Rb)},#${o*2}]`,genthumb('STRH','ORR',(o,Rb,Rd)=>`0b100${b2(0,2)}${b2(o>>1,5)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                1:['ooooobbbddd',(o,Rb,Rd)=>`LDRH ${Regs(Rd)},[${Regs(Rb)},#${o*2}]`,genthumb('LDRH','ORR',(o,Rb,Rd)=>`0b100${b2(1,2)}${b2(o>>1,5)}${b2(Rb,3)}${b2(Rd,3)}`|0)],
                2:['dddoooooooo',(Rd,o)=>`STR  ${Regs(Rd)},[SP,#${o*4}]`,genthumb('STR','OSR',(o,Rb,Rd)=>`0b100${b2(2,2)}${b2(Rd,3)}${b2(o>>2,8)}`|0)],
                3:['dddoooooooo',(Rd,o)=>`LDR  ${Regs(Rd)},[SP,#${o*4}]`,genthumb('LDR','OSR',(o,Rb,Rd)=>`0b100${b2(3,2)}${b2(Rd,3)}${b2(o>>2,8)}`|0)],
            },
            '1010m':{
                0:['dddoooooooo',(Rd,o)=>`ADD  ${Regs(Rd)},[PC,#${o*4}]`,genthumb('ADD','OPR',(o,Rb,Rd)=>`0b10100${b2(Rd,3)}${b2(o>>2,8)}`|0)],
                1:['dddoooooooo',(Rd,o)=>`ADD  ${Regs(Rd)},[SP,#${o*4}]`,genthumb('ADD','OSR',(o,Rb,Rd)=>`0b10101${b2(Rd,3)}${b2(o>>2,8)}`|0)],
            },
            '1011mmmm':{
                0:{
                    'm':{
                        0:['ooooooo',(o)=>`ADD  SP,#${o*4}`,genthumb('ADD','OS',(o,Rd)=>`0b1011${b2(0,4)}0${b2(o>>2,7)}`|0)],
                        1:['ooooooo',(o)=>`SUB  SP,#${o*4}`,genthumb('SUB','OS',(o,Rd)=>`0b1011${b2(0,4)}1${b2(o>>2,7)}`|0)],
                    }
                },
                2:{
                    'mm':{
                        0:['sssddd',(Rs,Rd)=>`SXTH ${Regs(Rd)}, ${Regs(Rs)}`,genthumb('SXTH','RR',(Rs,Rd)=>`0b1011${b2(2,4)}${b2(0,2)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        1:['sssddd',(Rs,Rd)=>`SXTB ${Regs(Rd)}, ${Regs(Rs)}`,genthumb('SXTB','RR',(Rs,Rd)=>`0b1011${b2(2,4)}${b2(1,2)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        2:['sssddd',(Rs,Rd)=>`UXTH ${Regs(Rd)}, ${Regs(Rs)}`,genthumb('UXTH','RR',(Rs,Rd)=>`0b1011${b2(2,4)}${b2(2,2)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                        3:['sssddd',(Rs,Rd)=>`UXTB ${Regs(Rd)}, ${Regs(Rs)}`,genthumb('UXTB','RR',(Rs,Rd)=>`0b1011${b2(2,4)}${b2(3,2)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                    }
                },
                4: ['rrrrrrrr',(r)=>`PUSH {${'R7,R6,R5,R4,R3,R2,R1,R0'.split(',').filter((_,i)=>r&(1<<(7-i))).join(',')}}`,genthumb('PUSH','A',(Rlist)=>`0b1011010${b2(((Rlist&0x100)!=0)|0,1)}${b2(Rlist&0xff,8)}`|0)],
                5: ['rrrrrrrr',(r)=>`PUSH {${'R7,R6,R5,R4,R3,R2,R1,R0'.split(',').filter((_,i)=>r&(1<<(7-i))).join(',')}LR}`],
                10:{
                    'mm':{
                        0:['sssddd',(Rs,Rd)=>`REV  ${Regs(Rd)}, ${Regs(Rs)}`,genthumb('REV','RR',(Rs,Rd)=>`0b1011${b2(10,4)}${b2(0,2)}${b2(Rs,3)}${b2(Rd,3)}`|0)],
                    }
                },
                12: ['rrrrrrrr',(r)=>`POP  {${'R7,R6,R5,R4,R3,R2,R1,R0'.split(',').filter((_,i)=>r&(1<<(7-i))).join(',')}}`,genthumb('POP','A',(Rlist)=>`0b1011110${b2(((Rlist&0x200)!=0)|0,1)}${b2(Rlist&0xff,8)}`|0)],
                13: ['rrrrrrrr',(r)=>`POP  {${'R7,R6,R5,R4,R3,R2,R1,R0'.split(',').filter((_,i)=>r&(1<<(7-i))).join(',')}PC}`],
                14: ['oooooooo',(o)=>`BKPT #${o}`,genthumb('BKPT','O',(o)=>`0b1011${b2(14,4)}${b2(o,8)}`|0)],
                15: ['oooooooo',(o)=>((o==0x20)?`WFE`:(o==0x30)?`WFI`:`NOP`),genthumb('WFE','',(o)=>`0b1011${b2(15,4)}${b2(0x20,8)}`|0),genthumb('WFI','',(o)=>`0b1011${b2(15,4)}${b2(0x30,8)}`|0),genthumb('NOP','',(o)=>`0b1011${b2(15,4)}${b2(0,8)}`|0)],
            },
            '1100m':{
                0:['bbboooooooo',(Rb,r)=>`STM  ${Regs(Rb)}!,{${'R7,R6,R5,R4,R3,R2,R1,R0'.split(',').filter((_,i)=>r&(1<<(7-i))).join(',')}}`,genthumb('STM','AR',(Rlist,Rb)=>`0b11000${b2(Rb,3)}${b2(Rlist&0xff,8)}`|0)],
                1:['bbboooooooo',(Rb,r)=>`LDM  ${Regs(Rb)}!,{${'R7,R6,R5,R4,R3,R2,R1,R0'.split(',').filter((_,i)=>r&(1<<(7-i))).join(',')}}`,genthumb('LDM','AR',(Rlist,Rb)=>`0b11001${b2(Rb,3)}${b2(Rlist&0xff,8)}`|0)],
            },
            '1101mmmm':{
                0: ['oooooooo',(o)=>Bcond(0,o), genthumb('BEQ','O',(o)=>`0b1101${b2( 0,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                1: ['oooooooo',(o)=>Bcond(1,o), genthumb('BNE','O',(o)=>`0b1101${b2( 1,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                2: ['oooooooo',(o)=>Bcond(2,o), genthumb('BCS','O',(o)=>`0b1101${b2( 2,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                3: ['oooooooo',(o)=>Bcond(3,o), genthumb('BCC','O',(o)=>`0b1101${b2( 3,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                4: ['oooooooo',(o)=>Bcond(4,o), genthumb('BMI','O',(o)=>`0b1101${b2( 4,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                5: ['oooooooo',(o)=>Bcond(5,o), genthumb('BPL','O',(o)=>`0b1101${b2( 5,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                6: ['oooooooo',(o)=>Bcond(6,o), genthumb('BVS','O',(o)=>`0b1101${b2( 6,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                7: ['oooooooo',(o)=>Bcond(7,o), genthumb('BVC','O',(o)=>`0b1101${b2( 7,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                8: ['oooooooo',(o)=>Bcond(8,o), genthumb('BHI','O',(o)=>`0b1101${b2( 8,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                9: ['oooooooo',(o)=>Bcond(9,o), genthumb('BLS','O',(o)=>`0b1101${b2( 9,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                10:['oooooooo',(o)=>Bcond(10,o),genthumb('BGE','O',(o)=>`0b1101${b2(10,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                11:['oooooooo',(o)=>Bcond(11,o),genthumb('BLT','O',(o)=>`0b1101${b2(11,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                12:['oooooooo',(o)=>Bcond(12,o),genthumb('BGT','O',(o)=>`0b1101${b2(12,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                13:['oooooooo',(o)=>Bcond(13,o),genthumb('BLE','O',(o)=>`0b1101${b2(13,4)}${b2(((o>>1)-2)&0xff,8)}`|0)],
                15:['oooooooo',(o)=>`SWI  ${o}`,genthumb('SWI','O',(o)=>`0b1101${b2(15,4)}${b2(o&0xff,8)}`|0)],
            },
            '1110m':{
                0:['ooooooooooo',(o)=>`B    ${o&0x400?(this.lastAddr=(((o|~0x7ff)<<1)+4)):(this.lastAddr=((o<<1)+4))}  ;@PC+BL`,genthumb('B','O',(o)=>`0b11100${b2(((o>>1)-2)&0x7ff,11)}`|0)],
            },
            '1111m':{
                0:['ooooooooooo',(o)=>`;${(this.lastAddr=o)}`],
                1:['ooooooooooo',(o)=>'BL   '+(this.lastAddr&0x0400?(this.lastAddr=((((o<<1)+(this.lastAddr<<12))|-1^(1<<23)-1)+2)):(this.lastAddr=(2+((o<<1)+(this.lastAddr<<12)))))+'  ;@PC+BL',genthumb('BL','O',(o)=>`0b11110${b2((((o>>1)-1)>>11)&0x7ff,11)}11111${b2(((o>>1)-1)&0x7ff,11)}`|0)],
            }
        }
    }

    // hex formatting
    Hex8(v){ return ('0'+(v&0xFF).toString(16).toUpperCase()).slice(-2); }
    Hex16(v){ return ('000'+(v&0xFFFF).toString(16).toUpperCase()).slice(-4); }
    Hex32(v){ return ('0000000'+(v>>>0).toString(16).toUpperCase()).slice(-8); }

    // bit extraction
    bits(val,bitformat){
        let lc='',v=0,vals=[],arg=false;
        for(let i=0;i<bitformat.length;i++){
            const c=bitformat[i]; val<<=1;
            if(c==='0'||c==='1'){ if((c==='0')===!(val&0x10000)) continue; return null; }
            if(c!==lc){ vals.push(v); lc=c; v=0; arg=true; }
            v<<=1; v|=!!(val&0x10000);
        }
        if(arg) vals.push(v);
        vals[0]=val&0xFFFF;
        return vals;
    }

    // encode single instruction
    encodeThumb(code){
        if(code.includes(':')) code=code.split(':')[1]||'';
        const cc=code.split(';')[0].trim().toUpperCase().replaceAll('[','').replaceAll(']','');
        if(!cc) return null;
        const parts=cc.split(/\s+/), mnemonic=parts[0];
        const args=parts.slice(1).join('');
        const operands=args.includes('{')?args.split('!').map(o=>o.replace(',{','{')):args.split(',').map(o=>o.trim());

        if(mnemonic==='DCW') return [parseInt(operands[0],16),'DWC',[parseInt(operands[0],16)]];

        const FULL_REG=new Set(['MOV','CMP','ADD','SUB','BX','BLX']);
        let pattern='', parsed=[];

        if(args.length>0){
            for(const op of operands){
                if(/^R([0-9]|1[0-5])$/.test(op)){
                    const rs=parseInt(op.substring(1));
                    pattern=(rs>7?'H':'R')+pattern; parsed.unshift(rs);
                }else if(op==='SP'){ pattern='S'+pattern; parsed.unshift(13); }
                else if(op==='LR'){ pattern='L'+pattern; parsed.unshift(14); }
                else if(op==='PC'){ pattern='P'+pattern; parsed.unshift(15); }
                else if(op.startsWith('#')){ pattern='O'+pattern; parsed.unshift(parseInt(op.substring(1))); }
                else if(op.startsWith('{')&&op.endsWith('}')){
                    pattern='A'+pattern;
                    let mask=0;
                    for(const r of op.slice(1,-1).split(',')){
                        const t=r.trim();
                        if(t==='LR') mask|=0x100;
                        else if(t==='PC') mask|=0x200;
                        else if(t.startsWith('R')) mask|=(1<<parseInt(t.substring(1)));
                    }
                    parsed.unshift(mask);
                }else if(parseInt(op)+Number.MAX_VALUE){
                    pattern='O'+pattern; parsed.unshift(parseInt(op));
                }else{ parsed.push(op); return [null,mnemonic,parsed]; }
            }
        }

        if(!this.thumbgenMap[mnemonic]||!this.thumbgenMap[mnemonic][pattern]){
            if(FULL_REG.has(mnemonic)){
                pattern=pattern.replaceAll('S','R').replaceAll('P','R').replaceAll('L','R').replaceAll('H','R');
                if(!this.thumbgenMap[mnemonic]||!this.thumbgenMap[mnemonic][pattern])
                    throw Error(`No matching pattern for ${mnemonic} with ${pattern}`);
            }else throw Error(`No matching pattern for ${mnemonic} with ${pattern}`);
        }
        return [this.thumbgenMap[mnemonic][pattern](...parsed), mnemonic, parsed];
    }

    // assemble multi-line asm to bytes
    parseASM(asm, advaddr=true){
        let data=[];
        let asmline=asm.split('\n');
        let litRefs=[]; // declare here for use in post-pass and pool append

        if(advaddr){
            // === Pre-pass: detect LDR Rd, =value ===
            for(let i=0;i<asmline.length;i++){
                const m=asmline[i].match(/^\s*LDR\s+(R\d+|SP|LR|PC)\s*,\s*=(0x[0-9a-fA-F]+|\d+)\b/i);
                if(m){
                    const rd=m[1].toUpperCase();
                    const vs=m[2];
                    const val=vs.toLowerCase().startsWith('0x')?parseInt(vs,16):parseInt(vs,10);
                    asmline[i]=`LDR ${rd}, [PC, #0]`; // temp offset
                    litRefs.push({lineIdx:i,rdName:rd,value:val});
                }
            }

            let addrmap={}, bmap=[], nullline=[], addr=0;
            const labeltype=new Set(['BIC','BKPT','BX','BLX']);

            // Pass 1: collect labels, branch map, and LDR =value instAddrs
            for(let i=0;i<asmline.length;i++){
                const line=asmline[i];
                if(line.includes(':')) addrmap[line.split(':')[0].trim().toLowerCase()]=addr;

                const ref=litRefs.find(r=>r.lineIdx===i);
                if(ref) ref.instAddr=addr;

                const e=this.encodeThumb(line);
                if(e!=null){
                    if(e[1]=='BL') addr+=2;
                    if(e[1][0]=='B'&&!labeltype.has(e[1])&&typeof e[2][0]==='string')
                        bmap.push([i,e[2][0].toLowerCase(),addr,line]);
                    addr+=2;
                }else{
                    const cc=line.split(';')[0].trim().toUpperCase().replaceAll('[','').replaceAll(']','');
                    if(/^(B|BEQ|BNE|BCS|BCC|BMI|BPL|BVS|BVC|BHI|BLS|BGE|BLT|BGT|BLE)\s/.test(cc)&&!cc.includes(':')){
                        const parts=cc.split(/\s+/);
                        if(!/^-?\d+$/.test(parts[1])){
                            bmap.push([i,parts[1].toLowerCase(),addr,line]);
                            addr+=2;
                            continue;
                        }
                    }
                    nullline.push(i);
                }
            }

            // === Resolve LDR =value literal pool offsets ===
            if(litRefs.length>0){
                let poolAddr=(addr+3)&~3; // word-align after code
                for(const ref of litRefs){
                    ref.poolAddr=poolAddr;
                    const pcBase=(ref.instAddr+4)&~2; // (PC+4) word-align
                    const offset=poolAddr-pcBase; // byte offset (encoder >>2 = word)
                    if(offset<0||offset>255)
                        throw Error(`LDR =value: pool offset out of range (${offset})`);
                    asmline[ref.lineIdx]=`LDR ${ref.rdName}, [PC, #${offset}]`;
                    poolAddr+=4;
                }
            }

            // Replace labels with computed offsets (case-insensitive)
            for(const [idx,label,curAddr] of bmap){
                const target=addrmap[label];
                if(target!==undefined){
                    const offset=target-curAddr;
                    asmline[idx]=asmline[idx].replace(new RegExp('\\b'+label+'\\b','i'),`${offset}`);
                }
            }

            nullline.map(x=>asmline[x]='');
        }

        const w16=b=>{ data.push(b&0xFF); data.push((b>>8)&0xFF); };

        // Pass 2: generate bytes
        asmline.map(x=>{
            const e=this.encodeThumb(x);
            if(e!=null){
                const v=e[0];
                if((v&0xFFFF0000)!==0||v<0){ w16(v>>>16); w16(v&0xFFFF); }
                else w16(v&0xFFFF);
            }
        });

        // === Append literal pool (4-byte words) ===
        if(litRefs&&litRefs.length>0){
            while(data.length&2){ data.push(0); } // halfword pad
            for(const ref of litRefs){
                const val=ref.value;
                w16(val&0xFFFF); w16((val>>>16)&0xFFFF);
            }
        }

        return data;
    }

    // recursive decoder
    decodeThumb(tab,vals,org=0){
        if(tab==null) return `DCW  ${this.Hex16(org)}  ;not found`;
        for(const key of Object.keys(tab)){
            let v=this.bits(vals,key);
            if(!v) continue;
            let next=tab[key][v[1]];
            if(Array.isArray(next)){
                v=this.bits(v[0],next[0]);
                switch(v.length){ case 2: return next[1](v[1]); case 3: return next[1](v[1],v[2]); case 4: return next[1](v[1],v[2],v[3]); }
                return null;
            }else return this.decodeThumb(next,v[0],vals);
        }
    }

    // disassemble bytes to asm
    parseThumb(bin,addrview=false,jmpfix=true){
        let asm=[], addr=0, base=this.baseAddr;
        const dv=new DataView(new Uint8Array(bin).buffer);
        let count=bin.length;
        let dcw=[], qjmp=new Set();

        while(count>=2){
            const code=dv.getUint16(addr,true);
            if(dcw.includes(addr)){
                asm.push(addrview?`:${this.Hex32(base+addr)} ${this.Hex16(code)}  DCW  ${this.Hex16(code)}`:`DCW  ${this.Hex16(code)}`);
                dcw.splice(dcw.indexOf(addr),1);
            }else{
                let asmv=this.decodeThumb(this.InstructionsCode,code);
                const lastAddr=this.lastAddr;
                let asmv2=addrview?`:${this.Hex32(base+addr)} ${this.Hex16(code)}  ${asmv}`:`${asmv}`;

                if(asmv2.includes(';')){
                    const tag=asmv2.split('@')[1];
                    if(tag==='PC+ADDR'){
                        const vaddr=(addr+lastAddr+4)&~2;
                        dcw.push(vaddr,vaddr+2);
                        asmv2=asmv2.replace('PC+ADDR',
                            `0x${this.Hex32(base+vaddr)}=0x${
                                (vaddr+4<=bin.length)?this.Hex32(dv.getUint32(vaddr,true)):'????????'
                            }`);
                    }else if(tag==='PC+BL'||tag==='PC+B'){
                        if(jmpfix&&(addr+lastAddr)>=0&&(addr+lastAddr)<bin.length){
                            const target=base+addr+lastAddr;
                            asmv2=`${asmv2.split(' ')[0]} Q${this.Hex32(target)}  ;${
                                asmv2.split(';')[0].trim()
                            }->0x${this.Hex32(target)} ${this.AddrName[target]||''}`;
                            qjmp.add((addr+lastAddr)>>1);
                        }else asmv2=addrview?`:${this.Hex32(base+addr)} ${this.Hex16(code)}  DCW  ${this.Hex16(code)}`:`DCW  ${this.Hex16(code)}`;
                    }
                }
                asm.push(asmv2);
            }
            addr+=2; count-=2;
        }

        if(jmpfix){
            Array.from(qjmp).sort((a,b)=>a-b).reverse().map(x=>
                asm[x]=`Q${this.Hex32(base+(x<<1))}:${this.AddrName[base+(x<<1)]?'     ;'+this.AddrName[base+(x<<1)]:''}\n`+asm[x]);
        }
        return asm.join('\n').replaceAll(';0\n','');
    }
}

// ============================================================
// Export
// ============================================================
if(typeof module!=='undefined'&&module.exports){
    module.exports={ThumbCPU,ThumbMemory,ThumbM0,REG};
}else if(typeof define==='function'&&define.amd){
    define(()=>({ThumbCPU,ThumbMemory,ThumbM0,REG}));
}else{
    window.ThumbCPU=ThumbCPU; window.ThumbMemory=ThumbMemory; window.ThumbM0=ThumbM0;
}
