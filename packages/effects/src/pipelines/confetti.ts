import type { EffectPipeline, PipelineConfig } from "../types.js";
import { CONFETTI_COMPUTE_SHADER, CONFETTI_RENDER_SHADER } from "../shaders/confetti.js";
import { hexToFloat3, createUniformBuffer } from "./base.js";

const NUM_PARTICLES = 400;
const FLOATS_PER_PARTICLE = 12;
const PARTICLE_BUFFER_SIZE = NUM_PARTICLES * FLOATS_PER_PARTICLE * 4;

// Compute uniform: dt, gravity, drag, time = 16 bytes
const COMPUTE_UNIFORM_SIZE = 16;

// Render uniform: resolution(2f) + time(f) + num_colors(f) + 6 colors(6×vec4f) = 112 bytes
const RENDER_UNIFORM_SIZE = 112;

/**
 * Confetti pipeline — compute shader for physics, render shader for instanced quads.
 *
 * Uses premultiplied alpha compositing. The CelebrationOverlay must configure
 * the canvas surface with alphaMode: 'premultiplied' for see-through effect.
 */
export class ConfettiPipeline implements EffectPipeline {
    private device: GPUDevice | null = null;
    private computePipeline: GPUComputePipeline | null = null;
    private renderPipeline: GPURenderPipeline | null = null;
    private particleBuffer: GPUBuffer | null = null;
    private computeUniformBuffer: GPUBuffer | null = null;
    private renderUniformBuffer: GPUBuffer | null = null;
    private computeBindGroup: GPUBindGroup | null = null;
    private renderBindGroup: GPUBindGroup | null = null;
    private computeUniformData = new Float32Array(4);
    private renderUniformData = new Float32Array(28); // 112 / 4
    private width = 0;
    private height = 0;
    private lastTime = 0;

    async init(device: GPUDevice, format: GPUTextureFormat, canvas: HTMLCanvasElement, config: PipelineConfig): Promise<void> {
        this.device = device;
        this.width = canvas.width;
        this.height = canvas.height;

        // --- Particle storage buffer ---
        const particleData = this.generateParticles(config);
        this.particleBuffer = device.createBuffer({
            size: PARTICLE_BUFFER_SIZE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.particleBuffer, 0, particleData.buffer);

        // --- Compute pipeline ---
        const computeModule = device.createShaderModule({ code: CONFETTI_COMPUTE_SHADER });
        const computeBGL = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" as const } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" as const } },
            ],
        });
        this.computePipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
            compute: { module: computeModule, entryPoint: "main" },
        });
        this.computeUniformBuffer = createUniformBuffer(device, COMPUTE_UNIFORM_SIZE);
        this.computeBindGroup = device.createBindGroup({
            layout: computeBGL,
            entries: [
                { binding: 0, resource: { buffer: this.computeUniformBuffer } },
                { binding: 1, resource: { buffer: this.particleBuffer } },
            ],
        });

        // --- Render pipeline ---
        const renderModule = device.createShaderModule({ code: CONFETTI_RENDER_SHADER });
        const renderBGL = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" as const } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" as const } },
            ],
        });
        this.renderPipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
            vertex: { module: renderModule, entryPoint: "vs" },
            fragment: {
                module: renderModule,
                entryPoint: "fs",
                targets: [{
                    format,
                    blend: {
                        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                    },
                }],
            },
            primitive: { topology: "triangle-list" },
        });
        this.renderUniformBuffer = createUniformBuffer(device, RENDER_UNIFORM_SIZE);
        this.renderBindGroup = device.createBindGroup({
            layout: renderBGL,
            entries: [
                { binding: 0, resource: { buffer: this.renderUniformBuffer } },
                { binding: 1, resource: { buffer: this.particleBuffer } },
            ],
        });

        // Set static render uniforms (resolution, colors)
        this.renderUniformData[0] = this.width;
        this.renderUniformData[1] = this.height;
        this.renderUniformData[3] = Math.min(config.colors.length, 6);
        for (let i = 0; i < 6; i++) {
            const hex = config.colors[i % config.colors.length] || "#ffffff";
            const [r, g, b] = hexToFloat3(hex);
            const offset = 4 + i * 4;
            this.renderUniformData[offset] = r;
            this.renderUniformData[offset + 1] = g;
            this.renderUniformData[offset + 2] = b;
            this.renderUniformData[offset + 3] = 1.0;
        }
    }

    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.renderUniformData[0] = width;
        this.renderUniformData[1] = height;
    }

    frame(encoder: GPUCommandEncoder, view: GPUTextureView, time: number, _pointer: { x: number; y: number } | null): void {
        if (!this.computePipeline || !this.renderPipeline || !this.device) return;
        if (!this.computeBindGroup || !this.renderBindGroup) return;
        if (!this.computeUniformBuffer || !this.renderUniformBuffer) return;

        // Compute pass: update particles
        const dt = Math.min(time - this.lastTime, 0.033); // cap at ~30fps delta
        this.lastTime = time;

        this.computeUniformData[0] = Math.max(dt, 0.001);
        this.computeUniformData[1] = 600.0;  // gravity (px/s²)
        this.computeUniformData[2] = 0.8;    // drag
        this.computeUniformData[3] = time;
        this.device.queue.writeBuffer(this.computeUniformBuffer, 0, this.computeUniformData);

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computeBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / 64));
        computePass.end();

        // Render pass: draw particles over darkened backdrop
        // Backdrop alpha follows timeline: 0→0.7 (0-0.5s), hold, 0.7→0 (3.5-4.5s)
        const backdropAlpha = this.computeBackdropAlpha(time);

        this.renderUniformData[2] = time;
        this.device.queue.writeBuffer(this.renderUniformBuffer, 0, this.renderUniformData);

        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view, loadOp: "clear", storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: backdropAlpha },
            }],
        });
        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.renderBindGroup);
        renderPass.draw(6, NUM_PARTICLES); // 6 vertices per quad, N instances
        renderPass.end();
    }

    destroy(): void {
        this.particleBuffer?.destroy();
        this.computeUniformBuffer?.destroy();
        this.renderUniformBuffer?.destroy();
        this.particleBuffer = null;
        this.computeUniformBuffer = null;
        this.renderUniformBuffer = null;
        this.computePipeline = null;
        this.renderPipeline = null;
        this.computeBindGroup = null;
        this.renderBindGroup = null;
        this.device = null;
    }

    private computeBackdropAlpha(time: number): number {
        if (time < 0.5) return (time / 0.5) * 0.7;          // fade in
        if (time < 3.5) return 0.7;                           // hold
        if (time < 4.5) return 0.7 * (1 - (time - 3.5));     // fade out
        return 0;
    }

    private generateParticles(config: PipelineConfig): Float32Array {
        const data = new Float32Array(NUM_PARTICLES * FLOATS_PER_PARTICLE);
        const w = this.width;
        const h = this.height;
        const numColors = Math.min(config.colors.length, 6);

        for (let i = 0; i < NUM_PARTICLES; i++) {
            const offset = i * FLOATS_PER_PARTICLE;
            // Position: spread across top, slightly above viewport
            data[offset + 0] = Math.random() * w;                    // pos.x
            data[offset + 1] = -Math.random() * h * 0.2;            // pos.y (above top)
            // Velocity: random spread, downward bias
            data[offset + 2] = (Math.random() - 0.5) * 300;         // vel.x
            data[offset + 3] = Math.random() * 150 + 50;            // vel.y (down)
            // Rotation
            data[offset + 4] = Math.random() * 6.283;               // rotation
            data[offset + 5] = (Math.random() - 0.5) * 8;           // angular_vel
            // Visual
            data[offset + 6] = Math.floor(Math.random() * numColors); // color_idx
            data[offset + 7] = 1.0;                                  // alpha
            data[offset + 8] = 4 + Math.random() * 8;               // size
            data[offset + 9] = 1.0 + Math.random() * 0.5;          // life
            data[offset + 10] = 0.3 + Math.random() * 0.7;         // aspect_ratio
            data[offset + 11] = 0;                                   // reserved
        }
        return data;
    }
}
