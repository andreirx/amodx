import type { EffectPipeline, PipelineConfig } from "../types.js";
import { PLASMA_SHADER } from "../shaders/plasma.js";
import {
    createFullscreenPipeline, createUniformBuffer,
    initStandardUniforms, updateFrameUniforms, updateStandardConfig,
    STANDARD_UNIFORM_FLOATS, STANDARD_UNIFORM_BYTES,
} from "./base.js";

export class PlasmaPipeline implements EffectPipeline {
    private device: GPUDevice | null = null;
    private pipeline: GPURenderPipeline | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private bindGroup: GPUBindGroup | null = null;
    private uniformData = new Float32Array(STANDARD_UNIFORM_FLOATS);

    async init(device: GPUDevice, format: GPUTextureFormat, canvas: HTMLCanvasElement, config: PipelineConfig): Promise<void> {
        this.device = device;
        const { pipeline, bindGroupLayout } = createFullscreenPipeline(device, PLASMA_SHADER, format);
        this.pipeline = pipeline;
        this.uniformBuffer = createUniformBuffer(device, STANDARD_UNIFORM_BYTES);
        this.bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
        });
        initStandardUniforms(this.uniformData, config);
        this.resize(canvas.width, canvas.height);
    }

    resize(width: number, height: number): void {
        this.uniformData[4] = width;
        this.uniformData[5] = height;
    }

    frame(encoder: GPUCommandEncoder, view: GPUTextureView, time: number, pointer: { x: number; y: number } | null): void {
        if (!this.pipeline || !this.bindGroup || !this.uniformBuffer || !this.device) return;
        updateFrameUniforms(this.uniformData, time, pointer);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view, loadOp: "clear", storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(3);
        pass.end();
    }

    updateConfig(config: Partial<PipelineConfig>): void {
        updateStandardConfig(this.uniformData, config);
    }

    destroy(): void {
        this.uniformBuffer?.destroy();
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;
        this.device = null;
    }
}
