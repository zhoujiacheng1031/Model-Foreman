"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

const views = [
  { label: "工作台", src: "/product-workbench.png", alt: "Model Foreman 工作台真实界面", position: "center", kind: "full" },
  { label: "任务输入", src: "/product-task-input.png", alt: "Model Foreman 任务输入真实界面", position: "center", kind: "strip" },
  { label: "角色与流程", src: "/product-roles.png", alt: "Model Foreman 角色与流程真实界面", position: "center", kind: "strip" },
  { label: "模型设置", src: "/product-settings.png", alt: "Model Foreman 模型设置真实界面", position: "center", kind: "full" },
  { label: "安全交付", src: "/product-workbench.png", alt: "Model Foreman 交付向导真实界面", position: "right", kind: "full" },
] as const;

export default function ProductTour() {
  const [active, setActive] = useState(0);
  const view = views[active];

  return (
    <section className="mf-tour" id="tour" aria-label="Model Foreman 产品导览">
      <div className="mf-window">
        <div className="mf-window-bar">
          <span className="mf-traffic" aria-hidden="true"><i /><i /><i /></span>
          <strong>Model Foreman</strong>
          <span>真实应用界面 · 敏感信息已脱敏</span>
        </div>
        <div className={`mf-window-screen mf-window-screen-${view.position} mf-window-screen-${view.kind}`} key={view.label}>
          <img src={view.src} alt={view.alt} />
        </div>
      </div>
      <div className="mf-tour-tabs" role="tablist" aria-label="选择产品界面">
        {views.map((item, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={active === index}
            className={active === index ? "active" : ""}
            onClick={() => setActive(index)}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            key={item.label}
          >
            <span>0{index + 1}</span>{item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
