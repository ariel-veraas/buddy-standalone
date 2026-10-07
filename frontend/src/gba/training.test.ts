import { describe, expect, it } from "vitest";
import { detectMedals, medalDiff, variantRows, weekLabel, type Medal } from "./training";
const medal: Medal = {id:"biblioteca", name:"Biblioteca", desc:"Diez temas",earned:true,progress:10,target:10};
describe("training helpers", () => {
  it("diff only includes newly earned medals", () => { expect(medalDiff([medal,{...medal,id:"locked",earned:false}],[])).toEqual([medal]); expect(medalDiff([medal],[medal.id])).toEqual([]); });
  it("records first visit then celebrates once per user", () => { const map=new Map<string,string>(); const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}}; expect(detectMedals(1,[],storage)).toEqual([]); expect(detectMedals(1,[medal],storage)).toEqual([medal]); expect(detectMedals(1,[medal],storage)).toEqual([]); expect(detectMedals(2,[medal],storage)).toEqual([]); });
  it("tolerates blocked and corrupt storage", () => { expect(detectMedals(1,[medal],{getItem:()=>{throw Error();},setItem:()=>{}})).toEqual([]); expect(detectMedals(1,[medal],{getItem:()=>"{}",setItem:()=>{}})).toEqual([]); });
  it("formats ISO week including year transitions", () => { expect(weekLabel("2026-W41")).toBe("Semana 41 · 2026"); expect(weekLabel("2027-W01")).toBe("Semana 1 · 2027"); expect(weekLabel("invalid")).toBe("Sesión semanal"); });
  it("keeps tied variant winners and doesn't mutate input", () => { const input=[{top_k:4,passed:3,total:5},{top_k:6,passed:3,total:5},{top_k:2,passed:1,total:5}]; expect(variantRows(input).map(v=>v.best)).toEqual([true,true,false]); expect(variantRows(input)[0].result).toBe("3 / 5"); expect(input[0]).not.toHaveProperty("best"); expect(variantRows([])).toEqual([]); });
});
